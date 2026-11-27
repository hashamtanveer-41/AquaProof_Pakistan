import math
import os
from collections import OrderedDict
from copy import deepcopy
from datetime import UTC, date, datetime, timedelta
from itertools import pairwise
from threading import Lock
from time import monotonic
from zoneinfo import ZoneInfo

import httpx
from fastapi import HTTPException

from ..service_http import ProviderError
from . import openweather
from . import weather_backup as backup

TIMEZONE = "Asia/Karachi"
LOCAL_ZONE = ZoneInfo(TIMEZONE)
_cache = OrderedDict()
_cache_lock = Lock()
_cache_generation = 0

def number(value):
    if type(value) in (float, int) and math.isfinite(value):
        return value
    return None


def timestamp(value):
    instant = datetime.fromisoformat(value)
    if instant.tzinfo is None:
        raise ValueError("Expected a timestamp with timezone")
    return instant


def point_query(lat, lon):
    return f"{lat},{lon}"


def _geocode(query, country=None):
    response = httpx.get(os.getenv(
        "OPEN_METEO_GEOCODING_URL", "https://geocoding-api.open-meteo.com/v1/search"
    ), params={"name": query, "count": 8, "language": "en", "format": "json",
               **({"countryCode": country} if country else {})},
       headers=backup.REQUEST_HEADERS, timeout=10)
    response.raise_for_status()
    return [{
        "id": item["id"],
        "name": item["name"],
        "region": item.get("admin1"),
        "country": item.get("country"),
        "country_code": item.get("country_code"),
        "latitude": item["latitude"],
        "longitude": item["longitude"],
    } for item in response.json().get("results", [])]


def geocode(query, country=None):
    if len(query) < 2:
        return []
    try:
        return _geocode(query, country)
    except (httpx.HTTPError, ValueError, KeyError, TypeError) as error:
        raise HTTPException(502, "Place search is unavailable. You can still enter coordinates.") from error


def resolve_location(query):
    name, *qualifiers = (part.strip() for part in query.split(","))
    if len(qualifiers) == 1:
        try:
            lat, lon = float(name), float(qualifiers[0])
        except ValueError:
            pass
        else:
            if not (-90 <= lat <= 90 and -180 <= lon <= 180):
                raise HTTPException(422, "Latitude or longitude is out of range.")
            return lat, lon, None

    places = geocode(name)
    for place in places:
        labels = {value.casefold() for key in ("region", "country", "country_code") if (value := place.get(key))}
        if all(qualifier.casefold() in labels for qualifier in qualifiers):
            label = ", ".join(filter(None, (place["name"], place.get("region"), place.get("country"))))
            return place["latitude"], place["longitude"], label
    raise HTTPException(422, "Location could not be found. Try a place name or latitude, longitude.")


def fetch_weather(primary, fallback, feature, provider, usable):
    failures = []
    try:
        data = primary()
        if usable(data):
            return {**data, "source": openweather.SOURCE, "retrieved_at": datetime.now(UTC).isoformat()}
        failures.append("OpenWeather supplied stale or incomplete data")
    except ProviderError as error:
        failures.append(str(error))
    except (AttributeError, IndexError, KeyError, TypeError, ValueError):
        failures.append("OpenWeather supplied an invalid response")

    try:
        data = fallback()
        if usable(data):
            return {**data, "source": provider, "retrieved_at": datetime.now(UTC).isoformat(),
                    "fallback_reason": failures[0]}
        failures.append(f"{provider} supplied stale or incomplete data")
    except HTTPException as error:
        if error.status_code == 422:
            raise
        failures.append(f"{provider} returned HTTP {error.status_code}")
    except ProviderError as error:
        failures.append(f"{provider}: {error}")
    except (httpx.HTTPError, AttributeError, IndexError, KeyError, TypeError, ValueError) as error:
        failures.append(f"{provider}: {type(error).__name__}")
    raise HTTPException(502, f"{feature} is unavailable from both weather providers. " + ". ".join(failures)) from None


def usable_forecast(data):
    days = data["daily"]
    dates = [date.fromisoformat(row["date"]) for row in days]
    return (
        1 <= len(days) <= 14
        and all((right - left).days == 1 for left, right in pairwise(dates))
        and all(number(row.get(key)) is not None and row[key] >= 0 for row in days for key in ("rain_mm", "eto_mm"))
    )


def fresh_forecast(data):
    now = datetime.now(UTC)
    today = now.astimezone(LOCAL_ZONE).date().isoformat()
    return (
        usable_forecast(data)
        and data["daily"][0]["date"] == today
        and any(-timedelta(hours=2) <= timestamp(row["time"]) - now <= timedelta(minutes=75)
                for row in data.get("hourly", []))
    )


def fresh_current(data):
    now = datetime.now(UTC)
    temperature = number(data.get("temperature_c"))
    return (temperature is not None and -90 <= temperature <= 65
            and isinstance(data.get("time"), str)
            and -timedelta(minutes=10) <= now - timestamp(data["time"]) <= timedelta(hours=3))


def cached(cache_key, loader, max_age=180):
    with _cache_lock:
        generation = _cache_generation
        entry = _cache.get(cache_key)
        if entry and monotonic() - entry[0] < max_age:
            _cache.move_to_end(cache_key)
            return deepcopy(entry[1])
    result = loader()
    with _cache_lock:
        if generation == _cache_generation:
            _cache[cache_key] = (monotonic(), deepcopy(result))
            _cache.move_to_end(cache_key)
            if len(_cache) > 512:
                _cache.popitem(last=False)
    return result


def evict_point(latitude, longitude):
    global _cache_generation
    coordinate = point_query(latitude, longitude)
    with _cache_lock:
        _cache_generation += 1
        for key in list(_cache):
            if key[1:2] == (coordinate,) or key[1:3] == (latitude, longitude):
                _cache.pop(key)


def fresh_openweather_forecast(data):
    now = datetime.now(UTC)
    rows = data.get("hourly", [])
    return bool(rows and -timedelta(hours=2) <= timestamp(rows[0]["time"]) - now <= timedelta(hours=3, minutes=10))


def field_weather_risks(rows):
    return [
        risk for risk, key, threshold in (
            ("heat", "max_c", lambda value: value >= 40),
            ("frost", "min_c", lambda value: value <= 2),
            ("heavy_rain", "rain_mm", lambda value: value >= 40),
        ) if any(row.get(key) is not None and threshold(row[key]) for row in rows)
    ]


def forecast(location, *, refresh=False):
    def load():
        point = resolve_location(location)
        return fetch_weather(
            lambda: openweather.forecast(*point), lambda: backup.forecast(*point),
            "Forecast", backup.OPEN_METEO,
            lambda data: fresh_openweather_forecast(data) if data.get("interval_hours") == 3 else fresh_forecast(data),
        )
    return load() if refresh else cached(("forecast", location, datetime.now(LOCAL_ZONE).date()), load)


def current(location, *, refresh=False):
    def load():
        lat, lon, _ = resolve_location(location)
        return fetch_weather(
            lambda: openweather.current(lat, lon), lambda: backup.current(lat, lon),
            "Current conditions", backup.OPEN_METEO, fresh_current,
        )
    return load() if refresh else cached(("current", location), load)


def validated_weather(load, source, feature, usable):
    try:
        data = load()
        if usable(data):
            return {**data, "source": source, "retrieved_at": datetime.now(UTC).isoformat()}
        reason = "Missing required or fresh data"
    except ProviderError as error:
        reason = str(error)
    except (AttributeError, IndexError, KeyError, TypeError, ValueError):
        reason = "Invalid data schema"
    raise HTTPException(502, f"{feature} is unavailable from {source}. {reason}.") from None


def irrigation_forecast(location, *, refresh=False):
    def load():
        point = resolve_location(location)
        return validated_weather(
            lambda: backup.forecast(*point), backup.OPEN_METEO, "Daily rainfall and reference ET", fresh_forecast,
        )
    if refresh:
        return load()
    return cached(("irrigation", location, datetime.now(LOCAL_ZONE).date()), load)


def recent(location):
    lat, lon, _ = resolve_location(location)
    return cached(("recent", lat, lon), lambda: validated_weather(
        lambda: backup.recent(lat, lon), backup.OPEN_METEO, "Modeled recent history",
        lambda data: any(row.get("temperature_c") is not None for row in data["hourly"]),
    ))


def history(lat, lon, start, end):
    return validated_weather(
        lambda: backup.history(lat, lon, start, end), backup.NASA_POWER, "Historical weather",
        lambda data: bool(data["daily"]),
    )


def agriculture(lat, lon, *, refresh=False):
    def load():
        return validated_weather(
            lambda: backup.agriculture(lat, lon), backup.OPEN_METEO, "Soil and solar outlook",
            lambda data: any(row.get("solar_w_m2") is not None for row in data["hourly"]) and any(
                key.startswith("soil_moisture_") and value is not None
                for row in data["hourly"] for key, value in row.items()
            ),
        )
    return load() if refresh else cached(("agriculture", lat, lon), load)
