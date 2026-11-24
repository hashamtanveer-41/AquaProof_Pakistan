import math
import os
from datetime import UTC, date, datetime, time as clock_time
from zoneinfo import ZoneInfo

import httpx
from fastapi import HTTPException

from . import weather_backup as backup

SOURCE = "Tomorrow.io"
BASE_URL = "https://api.tomorrow.io/v4"
TIMEZONE = "Asia/Karachi"
LOCAL_ZONE = ZoneInfo(TIMEZONE)

CONDITIONS = {
    "temperature": "temperature_c",
    "temperatureApparent": "feels_like_c",
    "dewPoint": "dew_point_c",
    "humidity": "humidity_pct",
    "cloudCover": "cloud_pct",
    "visibility": "visibility_km",
    "pressureSurfaceLevel": "pressure_hpa",
    "precipitationProbability": "precip_probability_pct",
    "precipitationIntensity": "precip_rate_mmh",
    "rainIntensity": "rain_rate_mmh",
    "rainAccumulation": "rain_mm",
    "evapotranspiration": "eto_mm",
    "windDirection": "wind_direction_deg",
    "uvIndex": "uv_index",
    "weatherCode": "weather_code",
}
DAILY = {
    "temperatureMax": "max_c",
    "temperatureMin": "min_c",
    "temperatureAvg": "temperature_c",
    "rainAccumulationSum": "rain_mm",
    "evapotranspirationSum": "eto_mm",
    "humidityAvg": "humidity_pct",
    "dewPointAvg": "dew_point_c",
    "cloudCoverAvg": "cloud_pct",
    "visibilityMin": "visibility_km",
    "precipitationProbabilityMax": "precip_probability_pct",
    "uvIndexMax": "uv_index",
    "weatherCodeMax": "weather_code",
}
ARCHIVE = {
    "temperatureMax": "max_c",
    "temperatureMin": "min_c",
    "precipitationAccumulationSum": "precipitation_mm",
    "humidityAvg": "humidity_pct",
    "dewPointAvg": "dew_point_c",
    "cloudCoverAvg": "cloud_pct",
    "solarGHIAvg": "solar_w_m2",
}
AGRICULTURE = {
    "solarGHI": "solar_w_m2",
    "solarDNI": "solar_direct_w_m2",
    "solarDHI": "solar_diffuse_w_m2",
    "soilMoistureVolumetric0To10": "soil_moisture_surface_pct",
    "soilMoistureVolumetric10To40": "soil_moisture_10_40_pct",
    "soilMoistureVolumetric40To100": "soil_moisture_40_100_pct",
    "soilTemperature0To10": "soil_temperature_c",
}


def provider_json(path, *, params=None, body=None, feature, access_limited=False):
    key = os.getenv("TOMORROW_API_KEY", "").strip()
    if not key:
        raise HTTPException(503, "TOMORROW_API_KEY is missing on the server.")
    try:
        response = httpx.request(
            "GET" if body is None else "POST", f"{BASE_URL}/{path}",
            params=params, json=body,
            headers={"Accept": "application/json", "apikey": key, "Cache-Control": "no-cache"}, timeout=10,
        )
        status = response.status_code
        if status == 429:
            raise HTTPException(503, "Tomorrow.io's request limit was reached. Try again later.")
        if status == 401:
            raise HTTPException(503, "Tomorrow.io rejected the server's weather API credentials.")
        if status in (402, 403):
            if access_limited:
                raise HTTPException(403, f"Tomorrow.io denied access to {feature}. Check your API plan.")
            raise HTTPException(503, "Tomorrow.io denied access to weather. Check the server's API key and plan.")
        if status in (400, 404) and path == "weather/forecast" and body is None:
            raise HTTPException(422, "Tomorrow.io could not find that location. Try a place with a country or latitude, longitude.")
        response.raise_for_status()
        return response.json()
    except (httpx.HTTPError, ValueError):
        raise HTTPException(502, f"Tomorrow.io {feature} is unavailable. Try again later.") from None


def parse_response(feature, normalizer):
    try:
        return normalizer()
    except (AttributeError, KeyError, TypeError, ValueError):
        raise HTTPException(502, f"Tomorrow.io returned unusable {feature} data.") from None


def number(value):
    if type(value) in (float, int) and math.isfinite(value):
        return value
    return None


def mapped(values, fields):
    return {target: number(values.get(source)) for source, target in fields.items()}


def wind(values, field):
    speed = number(values.get(field))
    return round(speed * 3.6, 2) if speed is not None else None


def timestamp(value):
    instant = datetime.fromisoformat(value)
    if instant.tzinfo is None:
        raise ValueError("Expected a timestamp with timezone")
    return instant


def conditions(row):
    values = row["values"]
    return {
        "time": timestamp(row["time"]).astimezone(UTC).isoformat(),
        **mapped(values, CONDITIONS),
        "wind_kmh": wind(values, "windSpeed"),
        "gust_kmh": wind(values, "windGust"),
    }


def daily_conditions(row):
    values = row["values"]
    return {
        "date": timestamp(row["time"]).astimezone(LOCAL_ZONE).date().isoformat(),
        **mapped(values, DAILY),
        "sunrise": optional_time(values.get("sunriseTime")),
        "sunset": optional_time(values.get("sunsetTime")),
        "wind_kmh": wind(values, "windSpeedMax"),
        "gust_kmh": wind(values, "windGustMax"),
    }


def optional_time(value):
    return timestamp(value).astimezone(UTC).isoformat() if value else None


def point_query(lat, lon):
    return f"{lat},{lon}"


def forecast_payload(payload):
    timelines = payload["timelines"]
    daily = sorted((daily_conditions(row) for row in timelines["daily"]), key=lambda row: row["date"])
    dates = [date.fromisoformat(row["date"]) for row in daily]
    if not dates or any((right - left).days != 1 for left, right in zip(dates, dates[1:])):
        raise ValueError("Expected consecutive forecast dates")
    location = payload.get("location", {})
    return {
        "source": SOURCE,
        "timezone": TIMEZONE,
        "latitude": number(location.get("lat")),
        "longitude": number(location.get("lon")),
        "location_name": location.get("name"),
        "daily": daily,
        "hourly": observations(timelines.get("hourly")),
        "minutely": observations(timelines.get("minutely")),
    }


def observations(rows):
    return sorted((conditions(row) for row in rows or []), key=lambda row: row["time"])


def tomorrow_forecast(location):
    payload = provider_json("weather/forecast", params={"location": location, "units": "metric"}, feature="forecast")
    result = parse_response("forecast", lambda: forecast_payload(payload))
    if result["latitude"] is None or result["longitude"] is None:
        raise HTTPException(502, "Tomorrow.io returned a forecast without coordinates.")
    return result


def tomorrow_current(location):
    payload = provider_json("weather/realtime", params={"location": location, "units": "metric"}, feature="current conditions")
    return parse_response("current conditions", lambda: conditions(payload["data"]))


def tomorrow_recent(location):
    payload = provider_json(
        "weather/history/recent", params={"location": location, "units": "metric"},
        feature="recent history", access_limited=True,
    )
    return parse_response("recent history", lambda: {
        "daily": [daily_conditions(row) for row in payload["timelines"].get("daily") or []],
        "hourly": observations(payload["timelines"].get("hourly")),
    })


def timeline_intervals(payload, timestep):
    return next(
        (timeline["intervals"] for timeline in payload["data"]["timelines"] if timeline["timestep"] == timestep),
        [],
    )


def tomorrow_history(lat, lon, start, end):
    payload = provider_json("historical", feature="archive history", access_limited=True, body={
        "location": [lat, lon],
        "fields": [*ARCHIVE, "windSpeedAvg"],
        "timesteps": ["1d"],
        "startTime": datetime.combine(start, clock_time.min, UTC).isoformat(),
        "endTime": datetime.combine(end, clock_time(23, 59, 59), UTC).isoformat(),
        "timezone": "UTC",
        "units": "metric",
    })

    def normalize():
        rows = []
        for row in timeline_intervals(payload, "1d"):
            day = timestamp(row["startTime"]).astimezone(UTC).date()
            if start <= day <= end:
                rows.append({
                    "date": day.isoformat(),
                    **mapped(row["values"], ARCHIVE),
                    "wind_kmh": wind(row["values"], "windSpeedAvg"),
                })
        return sorted(rows, key=lambda row: row["date"])

    return {"daily": parse_response("archive history", normalize), "timezone": "UTC"}


def tomorrow_agriculture(lat, lon):
    payload = provider_json("timelines", feature="soil and solar layers", access_limited=True, body={
        "location": [lat, lon],
        "fields": list(AGRICULTURE),
        "timesteps": ["1h"],
        "startTime": "now",
        "endTime": "nowPlus24h",
        "units": "metric",
    })

    def normalize():
        rows = []
        for row in timeline_intervals(payload, "1h"):
            values = mapped(row["values"], AGRICULTURE)
            if any(value is not None for value in values.values()):
                rows.append({"time": timestamp(row["startTime"]).astimezone(UTC).isoformat(), **values})
        return sorted(rows, key=lambda row: row["time"])

    return {"hourly": parse_response("soil and solar", normalize), "soil_profile": "tomorrow"}


def _geocode(query):
    response = httpx.get(os.getenv(
        "OPEN_METEO_GEOCODING_URL", "https://geocoding-api.open-meteo.com/v1/search"
    ), params={"name": query, "count": 8, "language": "en", "format": "json"},
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


def geocode(query):
    if len(query) < 2:
        return []
    try:
        return _geocode(query)
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
    try:
        data = primary()
        if usable(data):
            return {**data, "source": SOURCE, "retrieved_at": datetime.now(UTC).isoformat()}
    except HTTPException:
        pass

    try:
        data = fallback()
        if usable(data):
            return {**data, "source": provider, "retrieved_at": datetime.now(UTC).isoformat()}
    except HTTPException as error:
        if error.status_code == 422:
            raise
    except (httpx.HTTPError, AttributeError, IndexError, KeyError, TypeError, ValueError):
        pass
    raise HTTPException(502, f"{feature} is unavailable from both weather providers. Try again shortly.") from None


def usable_forecast(data):
    days = data["daily"]
    dates = [date.fromisoformat(row["date"]) for row in days]
    return (
        bool(days)
        and all((right - left).days == 1 for left, right in zip(dates, dates[1:]))
        and all(row.get(key) is not None and row[key] >= 0 for row in days for key in ("rain_mm", "eto_mm"))
    )


def forecast(location):
    return fetch_weather(
        lambda: tomorrow_forecast(location), lambda: backup.forecast(*resolve_location(location)),
        "Forecast", backup.OPEN_METEO, usable_forecast,
    )


def current(location):
    return fetch_weather(
        lambda: tomorrow_current(location), lambda: backup.current(*resolve_location(location)[:2]),
        "Current conditions", backup.OPEN_METEO, lambda data: data.get("temperature_c") is not None,
    )


def recent(location):
    return fetch_weather(
        lambda: tomorrow_recent(location), lambda: backup.recent(*resolve_location(location)[:2]),
        "Recent history", backup.OPEN_METEO,
        lambda data: any(row.get("temperature_c") is not None or row.get("rain_mm") is not None
                         for row in data["hourly"] + data["daily"]),
    )


def history(lat, lon, start, end):
    return fetch_weather(
        lambda: tomorrow_history(lat, lon, start, end), lambda: backup.history(lat, lon, start, end),
        "Historical weather", backup.NASA_POWER,
        lambda data: any(value is not None for row in data["daily"] for key, value in row.items() if key != "date"),
    )


def agriculture(lat, lon):
    return fetch_weather(
        lambda: tomorrow_agriculture(lat, lon), lambda: backup.agriculture(lat, lon),
        "Soil and solar outlook", backup.OPEN_METEO,
        lambda data: (
            any(row.get("soil_temperature_c") is not None or any(
                key.startswith("soil_moisture_") and value is not None for key, value in row.items()
            ) for row in data["hourly"])
            and any(row.get("solar_w_m2") is not None for row in data["hourly"])
        ),
    )
