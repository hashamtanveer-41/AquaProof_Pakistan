import math
import os
import time
from datetime import date
from functools import lru_cache

import httpx
from fastapi import HTTPException

FORECAST = {
    "temperature_2m_max": "max_c",
    "temperature_2m_min": "min_c",
    "precipitation_sum": "rain_mm",
    "et0_fao_evapotranspiration": "eto_mm",
    "relative_humidity_2m_mean": "humidity_pct",
    "wind_speed_10m_max": "wind_kmh",
}
HISTORY = {
    "T2M_MAX": "max_c",
    "T2M_MIN": "min_c",
    "PRECTOTCORR": "rain_mm",
    "ALLSKY_SFC_SW_DWN": "solar_mj_m2",
}


def fetch_json(url, params):
    response = httpx.get(url, params=params, timeout=15)
    response.raise_for_status()
    return response.json()


def observation(value):
    if isinstance(value, (int, float)) and math.isfinite(value) and value > -900:
        return value
    return None


@lru_cache(maxsize=128)
def _forecast(lat, lon, bucket):
    result = fetch_json(os.getenv("OPEN_METEO_URL", "https://api.open-meteo.com/v1/forecast"), {
        "latitude": lat,
        "longitude": lon,
        "daily": ",".join(FORECAST),
        "timezone": "auto",
        "forecast_days": 7,
    })["daily"]
    days = [date.fromisoformat(day) for day in result["time"]]
    if len(days) != 7 or any((next_day - day).days != 1 for day, next_day in zip(days, days[1:])):
        raise ValueError("Expected seven consecutive forecast days")
    return [
        {"date": day.isoformat(), **{
            key: observation(result[source][index]) for source, key in FORECAST.items()
        }}
        for index, day in enumerate(days)
    ]


def forecast(lat, lon):
    try:
        return _forecast(lat, lon, int(time.time() // 900))
    except (httpx.HTTPError, ValueError, KeyError, TypeError, IndexError) as error:
        raise HTTPException(502, "Open-Meteo forecast is unavailable. Try again shortly.") from error


@lru_cache(maxsize=128)
def _history(lat, lon, start, end, bucket):
    result = fetch_json(os.getenv(
        "NASA_POWER_URL", "https://power.larc.nasa.gov/api/temporal/daily/point"
    ), {
        "latitude": lat,
        "longitude": lon,
        "start": start.strftime("%Y%m%d"),
        "end": end.strftime("%Y%m%d"),
        "parameters": ",".join(HISTORY),
        "community": "AG",
        "format": "JSON",
    })
    parameters = result["properties"]["parameter"]
    solar_units = result.get("parameters", {}).get("ALLSKY_SFC_SW_DWN", {}).get("units", "")
    dates = sorted({day for source in HISTORY for day in parameters[source]})
    rows = [
        {"date": date(int(day[:4]), int(day[4:6]), int(day[6:])).isoformat(), **{
            key: observation(parameters[source].get(day)) for source, key in HISTORY.items()
        }}
        for day in dates
    ]
    if "kwh" in solar_units.lower():
        for row in rows:
            if row["solar_mj_m2"] is not None:
                row["solar_mj_m2"] *= 3.6
    return rows


def history(lat, lon, start, end):
    try:
        return _history(lat, lon, start, end, int(time.time() // 3600))
    except (httpx.HTTPError, ValueError, KeyError, TypeError, IndexError) as error:
        raise HTTPException(502, "NASA POWER historical data is unavailable for those dates.") from error


@lru_cache(maxsize=128)
def _geocode(query, bucket):
    data = fetch_json(os.getenv(
        "OPEN_METEO_GEOCODING_URL", "https://geocoding-api.open-meteo.com/v1/search"
    ), {"name": query, "count": 8, "language": "en", "format": "json"})
    return [{
        "id": item["id"],
        "name": item["name"],
        "region": item.get("admin1"),
        "country": item.get("country"),
        "latitude": item["latitude"],
        "longitude": item["longitude"],
    } for item in data.get("results", [])]


def geocode(query):
    if len(query) < 2:
        return []
    try:
        return _geocode(query, int(time.time() // 3600))
    except (httpx.HTTPError, ValueError, KeyError, TypeError) as error:
        raise HTTPException(502, "Place search is unavailable. You can still enter coordinates.") from error
