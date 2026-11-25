"""OpenWeather current conditions and five-day, three-hour forecast."""

import os
from collections import defaultdict
from datetime import UTC, datetime
from itertools import pairwise
from statistics import mean
from zoneinfo import ZoneInfo

from ..service_http import ProviderError, request_json
from .weather_backup import TIMEZONE, number

SOURCE = "OpenWeather"
BASE_URL = "https://api.openweathermap.org/data/2.5"
ZONE = ZoneInfo(TIMEZONE)


def payload(endpoint, lat, lon):
    key = os.getenv("OPENWEATHER_API_KEY", "").strip()
    if not key:
        raise ProviderError("Missing OPENWEATHER_API_KEY")
    try:
        data, _ = request_json("GET", f"{BASE_URL}/{endpoint}", params={
            "lat": lat, "lon": lon, "units": "metric", "appid": key,
        })
    except ProviderError as error:
        raise ProviderError(f"OpenWeather /{endpoint}: {error}", error.status) from None
    if str(data.get("cod")) != "200":
        raise ProviderError(f"OpenWeather /{endpoint}: provider returned an invalid success response")
    return data


def velocity(value):
    value = number(value)
    return round(value * 3.6, 2) if value is not None and value >= 0 else None


def conditions(row, hours):
    instant, main, wind = row["dt"], row["main"], row.get("wind", {})
    temperature = number(main.get("temp"))
    if type(instant) is not int or not 0 < instant < 4_102_444_800 or temperature is None or not -90 <= temperature <= 65:
        raise ValueError("Unusable OpenWeather timestamp or temperature")

    def depth(kind):
        bucket = row.get(kind)
        if bucket is None:
            return 0  # OpenWeather omits precipitation objects when that type is absent.
        value = number(bucket.get(f"{hours}h"))
        return value if value is not None and value >= 0 else None

    rain, snow = depth("rain"), depth("snow")
    precip = (rain + snow) / hours if rain is not None and snow is not None else None
    prob = number(row.get("pop"))
    visibility = number(row.get("visibility"))
    return {
        "time": datetime.fromtimestamp(instant, UTC).isoformat(),
        "temperature_c": temperature,
        "feels_like_c": number(main.get("feels_like")),
        "humidity_pct": number(main.get("humidity")),
        "pressure_hpa": number(main.get("pressure")),
        "cloud_pct": number(row.get("clouds", {}).get("all")),
        "visibility_km": visibility / 1000 if visibility is not None and visibility >= 0 else None,
        "wind_kmh": velocity(wind.get("speed")),
        "gust_kmh": velocity(wind.get("gust")),
        "wind_direction_deg": number(wind.get("deg")),
        "precip_probability_pct": round(prob * 100, 2) if prob is not None and 0 <= prob <= 1 else None,
        "rain_mm": rain,
        "rain_rate_mmh": rain / hours if rain is not None else None,
        "precip_rate_mmh": precip,
    }


def current(lat, lon):
    data = payload("weather", lat, lon)
    try:
        return conditions(data, 1)
    except (AttributeError, KeyError, TypeError, ValueError):
        raise ProviderError("OpenWeather /weather: invalid data schema") from None


def forecast(lat, lon, name=None):
    data = payload("forecast", lat, lon)
    try:
        return forecast_payload(data, lat, lon, name)
    except (AttributeError, KeyError, TypeError, ValueError):
        raise ProviderError("OpenWeather /forecast: invalid data schema") from None


def forecast_payload(data, lat, lon, name):
    slots = data["list"]
    if not isinstance(slots, list) or not 1 <= len(slots) <= 40:
        raise ValueError("Invalid OpenWeather forecast length")
    rows = [conditions(slot, 3) for slot in slots]
    if any(right["dt"] - left["dt"] != 10_800 for left, right in pairwise(slots)):
        raise ValueError("OpenWeather forecast slots are not consecutive")
    groups = defaultdict(list)
    for row in rows:
        day = datetime.fromisoformat(row["time"]).astimezone(ZONE).date()
        groups[day.isoformat()].append(row)

    daily = []
    for day, sample in groups.items():
        def aggregate(key, fn, complete=False, rows=sample):
            values = [item[key] for item in rows if item[key] is not None]
            return fn(values) if values and (not complete or len(values) == len(rows)) else None

        daily.append({
            "date": day, "min_c": aggregate("temperature_c", min),
            "max_c": aggregate("temperature_c", max), "rain_mm": aggregate("rain_mm", sum, complete=True),
            "precip_probability_pct": aggregate("precip_probability_pct", max),
            "humidity_pct": aggregate("humidity_pct", mean),
            "wind_kmh": aggregate("wind_kmh", max), "gust_kmh": aggregate("gust_kmh", max),
            "eto_mm": None, "forecast_periods": len(sample),
        })
    return {
        "timezone": TIMEZONE, "latitude": lat, "longitude": lon,
        "location_name": name or data.get("city", {}).get("name"),
        "daily": daily, "hourly": rows, "interval_hours": 3,
    }
