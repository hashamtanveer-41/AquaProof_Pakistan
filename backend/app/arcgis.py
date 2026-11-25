"""Pakistan-scoped geocoding and ArcGIS basemap configuration."""

import json
import math
import os
import re
from functools import lru_cache
from typing import Annotated, Literal
from urllib.parse import quote, urlsplit

import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from .science import weather
from .service_http import ProviderError, request_json

GEOCODE = "https://geocode-api.arcgis.com/arcgis/rest/services/World/GeocodeServer"
STYLES = "https://basemapstyles-api.arcgis.com/arcgis/rest/services/styles/v2/styles/arcgis"
STYLE_NAMES = {"street": "streets", "satellite": "imagery/standard", "hybrid": "imagery"}
TILE_SERVICES = {
    "image": "https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer",
    "vector": "https://basemaps-api.arcgis.com/arcgis/rest/services/World_Basemap_v2/VectorTileServer",
}
ASSET_PREFIX = "/api/map/basemap-assets"
_assets = httpx.Client(timeout=httpx.Timeout(12, connect=5), follow_redirects=False)
PAKISTAN = ("PAK", "PK")
router = APIRouter(prefix="/api/map", tags=["GIS"])
SearchText = Annotated[str, Query(min_length=2, max_length=120)]


def geocoder(operation, **params):
    key = os.getenv("ARCGIS_API_KEY", "").strip()
    if not key:
        raise ProviderError("ARCGIS_API_KEY is missing")
    data, response = request_json(
        "GET", f"{GEOCODE}/{operation}", params={"f": "json", **params},
        headers={"X-Esri-Authorization": f"Bearer {key}"},
    )
    if "error" in data:
        code = data["error"].get("code") if isinstance(data["error"], dict) else None
        raise ProviderError(f"ArcGIS application error {code}" if type(code) is int else "ArcGIS application error",
                            code if type(code) is int else None)
    return data, response


def bounds(lon, lat):
    return (type(lon) in (int, float) and type(lat) in (int, float)
            and math.isfinite(lon) and math.isfinite(lat)
            and -180 <= lon <= 180 and -90 <= lat <= 90)


def candidates(q, magic_key=None):
    params = {"SingleLine": q, "countryCode": "PAK", "outSR": 4326,
              "outFields": "LongLabel,Region,Country", "maxLocations": 8, "forStorage": "false"}
    if magic_key:
        params["magicKey"] = magic_key
    data, _ = geocoder("findAddressCandidates", **params)
    items = data.get("candidates")
    if not isinstance(items, list):
        raise ProviderError("ArcGIS candidates schema is invalid")
    result = []
    for index, item in enumerate(items):
        try:
            x, y = item["location"]["x"], item["location"]["y"]
            name, attributes = item["address"], item["attributes"]
            if bounds(x, y) and isinstance(name, str) and attributes.get("Country") in PAKISTAN:
                result.append({"id": f"esri-{index}", "name": name, "region": attributes.get("Region"),
                               "country": "Pakistan", "country_code": "PK", "latitude": y, "longitude": x})
        except (AttributeError, KeyError, TypeError):
            continue
    if items and not result:
        raise ProviderError("ArcGIS returned unusable Pakistani location candidates")
    return result


@router.get("/config")
def map_config():
    token = os.getenv("ARCGIS_BROWSER_TOKEN", "").strip()
    if token == os.getenv("ARCGIS_API_KEY", "").strip():
        token = ""
    server_basemaps = bool(server_key()) and not token
    result = {"browser_token": token or None,
              "digitization_authorized": bool(token or server_basemaps)
              and os.getenv("ARCGIS_DIGITIZATION_AUTHORIZED") == "1"}
    if server_basemaps:
        result["server_basemaps"] = True
    return result


def server_key():
    if os.getenv("ARCGIS_SERVER_BASEMAPS") == "1":
        return os.getenv("ARCGIS_API_KEY", "").strip()
    return ""


def without_query(url):
    parsed = urlsplit(url)
    return parsed._replace(query="", fragment="").geturl()


@lru_cache(maxsize=6)
def server_style(style, key):
    data, _ = request_json("GET", f"{STYLES}/{STYLE_NAMES[style]}", params={"token": key})
    sources = data.get("sources")
    if data.get("version") != 8 or not isinstance(sources, dict) or not sources or not data.get("layers"):
        raise ProviderError("ArcGIS returned an invalid basemap style")
    for source in sources.values():
        if not isinstance(source, dict) or not isinstance(source.get("url"), str):
            raise ProviderError("ArcGIS returned an unsupported basemap source")
        service = without_query(source["url"])
        kind = next((name for name, base in TILE_SERVICES.items() if base == service), None)
        if kind is None:
            raise ProviderError("ArcGIS returned an unsupported tile service")
        suffix = ".pbf" if kind == "vector" else ""
        source.pop("url")
        source["tiles"] = [f"{ASSET_PREFIX}/{kind}/{{z}}/{{y}}/{{x}}{suffix}"]
    if "glyphs" in data:
        data["glyphs"] = f"{ASSET_PREFIX}/fonts/{{fontstack}}/{{range}}.pbf"
    if "sprite" in data:
        sprite = without_query(data["sprite"])
        if not re.fullmatch(r"https://cdn\.arcgis\.com/sharing/rest/content/items/[a-f0-9]{32}/resources/[a-zA-Z0-9_./-]+",
                            sprite):
            raise ProviderError("ArcGIS returned an unsupported sprite URL")
        data["sprite"] = sprite
    # Reject an unexpected copy of the key in provider metadata as well.
    if key in json.dumps(data):
        raise ProviderError("ArcGIS returned credential-bearing style metadata")
    return data


@router.get("/basemap-style/{style}")
def basemap_style(style: Literal["street", "satellite", "hybrid"]):
    if not (key := server_key()):
        raise HTTPException(404, "Server-side ArcGIS basemaps are disabled")
    try:
        return server_style(style, key)
    except (ProviderError, TypeError, ValueError):
        raise HTTPException(502, "ArcGIS basemap style is unavailable") from None


@router.get("/basemap-assets/{kind}/{asset:path}")
def basemap_asset(kind: Literal["image", "vector", "fonts"], asset: str):
    if not (key := server_key()):
        raise HTTPException(404, "Server-side ArcGIS basemaps are disabled")
    if kind == "fonts":
        match = re.fullmatch(r"([\w .,-]{1,250})/(\d{1,5}-\d{1,5})\.pbf", asset)
        if not match:
            raise HTTPException(404, "Unknown ArcGIS font asset")
        url = f"{TILE_SERVICES['vector']}/resources/fonts/{quote(match[1], safe=',')}/{match[2]}.pbf"
    else:
        suffix = r"\.pbf" if kind == "vector" else ""
        match = re.fullmatch(r"(\d{1,2})/(\d{1,8})/(\d{1,8})" + suffix, asset)
        if not match:
            raise HTTPException(404, "Unknown ArcGIS tile")
        z, y, x = map(int, match.groups())
        if z > 24 or max(x, y) >= 2 ** z:
            raise HTTPException(404, "ArcGIS tile coordinates are out of range")
        url = f"{TILE_SERVICES[kind]}/tile/{asset}"
    try:
        upstream = _assets.get(url, params={"token": key})
    except httpx.RequestError:
        raise HTTPException(502, "ArcGIS asset request failed") from None
    media = upstream.headers.get("content-type", "").split(";", 1)[0]
    allowed = ("image/jpeg", "image/png", "image/webp") if kind == "image" else (
        "application/x-protobuf", "application/octet-stream", "application/vnd.mapbox-vector-tile",
    )
    if upstream.status_code != 200 or media not in allowed:
        raise HTTPException(502, "ArcGIS asset unavailable")
    return Response(upstream.content, media_type=media)


@router.get("/search")
def search(q: SearchText, magic_key: Annotated[str | None, Query(max_length=1024)] = None):
    try:
        matches = candidates(q, magic_key)
        if matches:
            return {"source": "ArcGIS", "results": matches}
        problem = "No ArcGIS match"
    except ProviderError as error:
        problem = str(error)
    try:
        fallback = [p for p in weather.geocode(q, country="PK") if p.get("country_code") == "PK"]
    except HTTPException:
        raise HTTPException(502, f"ArcGIS: {problem}. Open-Meteo place search unavailable. Enter coordinates.") from None
    return {"source": "Open-Meteo", "results": fallback, "fallback_reason": problem}


@router.get("/suggest")
def suggest(q: SearchText):
    try:
        data, _ = geocoder("suggest", text=q, countryCode="PAK", maxSuggestions=6)
        items = data.get("suggestions")
        if not isinstance(items, list):
            raise ProviderError("ArcGIS suggestions schema is invalid")
        return [{
            "text": item["text"], "magic_key": item["magicKey"],
        } for item in items if isinstance(item, dict) and not item.get("isCollection")
            and isinstance(item.get("text"), str) and isinstance(item.get("magicKey"), str)]
    except ProviderError as error:
        raise HTTPException(503, f"ArcGIS suggestions: {error}. Submit the search or enter coordinates.") from None


@router.get("/reverse")
def reverse(latitude: Annotated[float, Query(ge=-90, le=90)],
            longitude: Annotated[float, Query(ge=-180, le=180)]):
    try:
        data, _ = geocoder("reverseGeocode", location=f"{longitude},{latitude}", outSR=4326,
                           outFields="LongLabel,CountryCode")
        address = data.get("address")
        label = address.get("LongLabel") if isinstance(address, dict) else None
        if not isinstance(label, str):
            raise ProviderError("ArcGIS returned no usable address")
        return {"name": label, "source": "ArcGIS"}
    except ProviderError as error:
        raise HTTPException(503, f"ArcGIS reverse geocoding: {error}. Coordinates remain available.") from None
