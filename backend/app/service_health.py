"""Credential and capability probes using public locations and no outbound messages."""

import json
import logging
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime, timedelta
from functools import partial
from threading import Lock
from time import monotonic, sleep
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException

from . import arcgis, assistant_model, waha
from .science import openweather, weather
from .science import weather_backup as backup
from .service_http import ProviderError, request_json

router = APIRouter(prefix="/api/admin", tags=["service health"])
POINTS = {
    "Punjab / Multan": (30.1575, 71.5249),
    "Sindh / Hyderabad": (25.396, 68.3578),
    "Khyber Pakhtunkhwa / Mardan": (34.198, 72.045),
    "Balochistan / Quetta": (30.1798, 66.975),
}
_snapshot = {}
_lock = Lock()
logging.getLogger("httpx").setLevel(logging.WARNING)


def required(*names):
    missing = [name for name in names if not os.getenv(name, "").strip()]
    if missing:
        raise ProviderError("Missing " + ", ".join(missing))


def checked(result, condition, message):
    if not condition(result):
        raise ProviderError(message)
    return result


def coverage(loader, predicate):
    samples = {}
    for district, point in POINTS.items():
        try:
            samples[district] = {"ok": bool(predicate(loader(*point))), "http_status": 200}
        except HTTPException as error:
            status = (error.headers or {}).get("X-Upstream-Status")
            samples[district] = {"ok": False, "detail": str(error.detail),
                                 "http_status": int(status) if status else None}
        except ProviderError as error:
            samples[district] = {"ok": False, "detail": str(error), "http_status": error.status}
        except (ValueError, KeyError, TypeError, IndexError, AttributeError) as error:
            samples[district] = {"ok": False, "detail": "Invalid response (" + type(error).__name__ + ")"}
    return {"coverage": samples}


def arcgis_style(path, token=None):
    # The interactive smoke test can inspect styles with a server credential;
    # production browsers must use a separate public, referrer-restricted token.
    token = token or arcgis.map_config()["browser_token"] or arcgis.server_key()
    if not token:
        raise ProviderError("Missing a separate ARCGIS_BROWSER_TOKEN or enabled server basemaps")
    data, response = request_json("GET", f"{arcgis.STYLES}/{path}",
                                  params={"token": token})
    if data.get("version") != 8 or not isinstance(data.get("sources"), dict) or not data.get("layers"):
        code = data.get("error", {}).get("code") if isinstance(data.get("error"), dict) else None
        raise ProviderError("ArcGIS style schema invalid" if not code else f"ArcGIS application error {code}",
                            code if type(code) is int else response.status_code)
    # Record hostnames only. Styles and TileJSON may include token-bearing URLs.
    sources = [source for source in data["sources"].values() if isinstance(source, dict)]
    resources = [data.get("glyphs"), data.get("sprite"),
                 *(source.get("url") for source in sources),
                 *(tile for source in sources for tile in source.get("tiles", []) if isinstance(tile, str))]
    return {**http_metadata(response), "asset_hosts": sorted({
        urlsplit(url).hostname for url in resources if isinstance(url, str) and urlsplit(url).hostname
    })}


def http_metadata(response):
    headers = response.headers
    quotas = {name: headers[name] for name in (
        "retry-after", "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset",
    ) if name in headers and len(headers[name]) < 48 and headers[name].isascii()
        and all(character.isdigit() or character in " .-" for character in headers[name])}
    return {"http_status": response.status_code, "rate_limit": quotas}


def groq():
    required("GROQ_API_KEY")
    key = os.environ["GROQ_API_KEY"]
    data, response = request_json("GET", "https://api.groq.com/openai/v1/models",
                                  headers={"Authorization": f"Bearer {key}"})
    models = checked(data.get("data"), lambda row: isinstance(row, list), "Groq model list schema invalid")
    return {**http_metadata(response), "models_available": len(models)}


def groq_completion():
    settings = assistant_model.config()
    if not settings:
        raise ProviderError("Missing GROQ_API_KEY or model")
    model = settings[1]
    usage = []
    message = assistant_model.request_model(None, [{"role": "user", "content": "Return the JSON object with ok set to true."}],
        usage, response_format={"type": "json_schema", "json_schema": {
            "name": "health", "strict": True, "schema": {"type": "object", "properties": {
                "ok": {"type": "boolean"}}, "required": ["ok"], "additionalProperties": False},
        }})
    if message.get("content") is None or json.loads(message["content"]) != {"ok": True}:
        raise ProviderError("Groq structured output did not match the probe")
    tool = assistant_model.request_model(None, [
        {"role": "user", "content": "Call the health_check function with no arguments."},
    ], usage, tools=[{"type": "function", "function": {
        "name": "health_check", "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
    }}], tool_choice={"type": "function", "function": {"name": "health_check"}})
    calls = tool.get("tool_calls")
    if not isinstance(calls, list) or len(calls) != 1 or calls[0].get("function", {}).get("name") != "health_check":
        raise ProviderError("Groq did not return the specified function call")
    return {"http_status": 200, "model": model, "structured_output": True, "function_call": True}


def whatsapp():
    required("WAHA_BASE_URL", "WAHA_API_KEY", "WAHA_WEBHOOK_SECRET")
    service = waha.settings()
    if not service:
        raise ProviderError("Invalid WAHA URL, session or credentials")
    # A paired session persists in the WAHA volume and reconnects on restart, passing briefly through
    # STARTING. Treat that reconnection window as healthy, restart a session WAHA left STOPPED/FAILED,
    # and tolerate a transient connection miss, so a probe never flaps to "degraded" for a temporary
    # state. Only an unpaired (SCAN_QR_CODE) or unreachable session is reported unhealthy.
    state = status = None
    for attempt in range(3):
        try:
            state, status = service.state()
        except waha.RetryBeforeSend:
            if attempt == 2:
                raise
            sleep(1.5)
            continue
        if state in ("STOPPED", "FAILED") and attempt < 2:
            try:
                service.start_pairing()
            except ProviderError:
                pass
            sleep(1.5)
            continue
        break
    return {"ok": state in ("WORKING", "STARTING"), "http_status": status,
            "detail": f"WAHA session: {state}"}


def raster(url):
    from httpx import get

    response = get(url, timeout=7, headers={"User-Agent": "AquaProof-Health/1.0"})
    if not response.is_success or not response.headers.get("content-type", "").startswith("image/"):
        raise ProviderError("Expected a raster tile image", response.status_code)
    return http_metadata(response)


def services():
    lat, lon = POINTS["Punjab / Multan"]
    previous = date.today() - timedelta(days=60)
    def openweather_check(loader, predicate):
        required("OPENWEATHER_API_KEY")
        return coverage(loader, predicate)

    def geocoding(path):
        required("ARCGIS_API_KEY")
        if path == "findAddressCandidates":
            cities = {point: site.split(" / ")[1] for site, point in POINTS.items()}
            return coverage(lambda y, x: arcgis.candidates(cities[(y, x)]), bool)
        if path == "suggest":
            return {"ok": bool(arcgis.suggest("Mult")), "http_status": 200}
        return {"ok": bool(arcgis.reverse(lat, lon).get("name")), "http_status": 200}

    yield "OpenWeather", f"{openweather.BASE_URL}/forecast", lambda: openweather_check(
        openweather.forecast, weather.fresh_openweather_forecast)
    yield "OpenWeather", f"{openweather.BASE_URL}/weather", lambda: openweather_check(
        openweather.current, weather.fresh_current)
    yield "Open-Meteo", os.getenv("OPEN_METEO_URL", "https://api.open-meteo.com/v1/forecast"), lambda: (
        coverage(backup.forecast, weather.fresh_forecast))
    meteo_url = os.getenv("OPEN_METEO_URL", "https://api.open-meteo.com/v1/forecast")
    yield "Open-Meteo current", meteo_url, lambda: coverage(backup.current, weather.fresh_current)
    yield "Open-Meteo soil and solar", meteo_url, lambda: coverage(backup.agriculture, lambda data: any(
        row.get("solar_w_m2") is not None and row.get("soil_moisture_0_1_pct") is not None
        for row in data["hourly"]))
    yield "Open-Meteo place search", os.getenv("OPEN_METEO_GEOCODING_URL", "https://geocoding-api.open-meteo.com/v1/search"), lambda: (
        {"ok": any(item["country_code"] == "PK" for item in weather.geocode("Multan", country="PK"))})
    yield "NASA POWER", os.getenv("NASA_POWER_URL", "https://power.larc.nasa.gov/api/temporal/daily/point"), lambda: (
        {"ok": any(row.get("precipitation_mm") is not None for row in backup.history(lat, lon, previous, previous)["daily"])})
    for path in ("findAddressCandidates", "suggest", "reverseGeocode"):
        yield "ArcGIS geocoding", f"{arcgis.GEOCODE}/{path}", lambda path=path: geocoding(path)
    for path in arcgis.STYLE_NAMES.values():
        yield "ArcGIS basemap styles", f"{arcgis.STYLES}/{path}", lambda path=path: arcgis_style(path)
    yield "Groq", "https://api.groq.com/openai/v1/models", groq
    yield "Groq", assistant_model.ENDPOINT, groq_completion
    yield "WAHA WhatsApp", "GET /api/sessions/{session}", whatsapp
    yield "OpenFreeMap", "https://tiles.openfreemap.org/styles/liberty", lambda: (
        {"ok": request_json("GET", "https://tiles.openfreemap.org/styles/liberty")[0].get("version") == 8})
    yield "OpenStreetMap", "https://tile.openstreetmap.org/{z}/{x}/{y}.png", lambda: (
        raster("https://tile.openstreetmap.org/5/22/13.png"))


def probe(item):
    provider, endpoint, check = item
    parsed = urlsplit(endpoint)
    endpoint = f"{parsed.scheme}://{parsed.hostname}{parsed.path}" if parsed.hostname else endpoint
    start = monotonic()
    result = {"provider": provider, "endpoint": endpoint}
    try:
        details = check()
        samples = details.get("coverage", {}).values()
        passed = [sample["ok"] for sample in samples]
        auth_error = {401, 402, 403, 498, 499}
        if passed and not any(passed):
            state = "misconfigured" if all(sample.get("http_status") in auth_error for sample in samples) else "unavailable"
        elif not details.get("ok", True) or (passed and not all(passed)):
            state = "degraded"
        else:
            state = "operational"
        result.update(details, status=state)
        if state != "operational" and "detail" not in result:
            result["detail"] = "Required fields, fresh data, or Pakistan sample coverage missing"
    except (ProviderError, assistant_model.ModelUnavailable, HTTPException) as error:
        status = getattr(error, "status", None) or getattr(error, "status_code", None)
        if isinstance(error, HTTPException) and (upstream := (error.headers or {}).get("X-Upstream-Status")):
            status = int(upstream)
        reason = str(error.detail) if isinstance(error, HTTPException) else str(error)
        result.update(status="misconfigured" if reason.startswith("Missing ") or status in (401, 403, 498, 499)
                      else "unavailable", detail=reason, http_status=status)
    except Exception as error:  # noqa: BLE001 - one failed provider must not cancel the snapshot
        result.update(status="unavailable", detail=type(error).__name__)
    return {**result, "checked_at": datetime.now(UTC).isoformat(), "latency_ms": round((monotonic() - start) * 1000)}


def run_checks():
    with ThreadPoolExecutor(max_workers=5) as workers:
        results = list(workers.map(probe, services()))
    with _lock:
        _snapshot["services"] = results
    return results


def refresh_whatsapp():
    """Re-probe only the WAHA session frequently so its status stays current between the 30-minute
    full sweeps. The probe self-heals a stopped session and tolerates reconnection, so WhatsApp does
    not sit on a stale "degraded" after a restart."""
    if not waha.settings():
        return
    result = probe(("WAHA WhatsApp", "GET /api/sessions/{session}", whatsapp))
    with _lock:
        services = _snapshot.setdefault("services", [])
        for index, item in enumerate(services):
            if item.get("provider") == "WAHA WhatsApp":
                services[index] = result
                break
        else:
            services.append(result)
    return result


@router.get("/services")
def service_status():
    with _lock:
        return {"enabled": os.getenv("AQUAPROOF_HEALTH_ENABLED", "1") == "1",
                "services": _snapshot.get("services", [])}


if __name__ == "__main__":
    import argparse
    from getpass import getpass

    parser = argparse.ArgumentParser()
    parser.add_argument("--credential-smoke", action="store_true")
    parser.add_argument("--probe-model-routes", action="store_true",
                        help="Also test alternate models using only synthetic requests.")
    args = parser.parse_args()
    if args.credential_smoke:
        os.environ["ARCGIS_API_KEY"] = getpass("ArcGIS key (hidden): ").strip()
        os.environ["GROQ_API_KEY"] = getpass("Groq key (hidden): ").strip()
        selected = []
        for provider, endpoint, check in services():
            if provider == "ArcGIS basemap styles":
                path = endpoint.removeprefix(arcgis.STYLES + "/")
                check = partial(arcgis_style, path, os.environ["ARCGIS_API_KEY"])
            if provider in ("ArcGIS basemap styles", "ArcGIS geocoding", "Groq"):
                selected.append((provider, endpoint, check))
        print(json.dumps([probe(item) for item in selected], indent=2))
        if args.probe_model_routes:
            for model in ("openai/gpt-oss-120b", "openai/gpt-oss-20b", "moonshotai/kimi-k2-instruct"):
                os.environ["GROQ_MODEL"] = model
                print(json.dumps({"model": model, **probe(
                    ("Groq", assistant_model.ENDPOINT, groq_completion)
                )}))
    else:
        print(json.dumps(run_checks(), indent=2))
