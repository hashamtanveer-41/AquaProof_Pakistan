"""Weather backups and their normalization into AquaProof's API units."""

import math
import os
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

import httpx

OPEN_METEO = "Open-Meteo"
NASA_POWER = "NASA POWER"
TIMEZONE = "Asia/Karachi"
REQUEST_HEADERS = {"Cache-Control": "no-cache"}

HOURLY = {
    "temperature_2m": "temperature_c",
    "apparent_temperature": "feels_like_c",
    "relative_humidity_2m": "humidity_pct",
    "dew_point_2m": "dew_point_c",
    "cloud_cover": "cloud_pct",
    "surface_pressure": "pressure_hpa",
    "precipitation_probability": "precip_probability_pct",
    "et0_fao_evapotranspiration": "eto_mm",
    "wind_speed_10m": "wind_kmh",
    "wind_gusts_10m": "gust_kmh",
    "wind_direction_10m": "wind_direction_deg",
    "uv_index": "uv_index",
}
DAILY = {
    "temperature_2m_min": "min_c",
    "temperature_2m_max": "max_c",
    "et0_fao_evapotranspiration": "eto_mm",
    "relative_humidity_2m_mean": "humidity_pct",
    "precipitation_probability_max": "precip_probability_pct",
    "wind_speed_10m_max": "wind_kmh",
    "wind_gusts_10m_max": "gust_kmh",
    "uv_index_max": "uv_index",
}
SOIL = {
    "soil_moisture_0_to_1cm": "soil_moisture_0_1_pct",
    "soil_moisture_1_to_3cm": "soil_moisture_1_3_pct",
    "soil_moisture_3_to_9cm": "soil_moisture_3_9_pct",
    "soil_moisture_9_to_27cm": "soil_moisture_9_27_pct",
    "soil_moisture_27_to_81cm": "soil_moisture_27_81_pct",
}
AGRICULTURE = {
    "soil_temperature_0cm": "soil_temperature_c",
    **SOIL,
    "shortwave_radiation": "solar_w_m2",
    "direct_normal_irradiance": "solar_direct_w_m2",
    "diffuse_radiation": "solar_diffuse_w_m2",
}
ARCHIVE = {
    "T2M_MAX": "max_c",
    "T2M_MIN": "min_c",
    "PRECTOTCORR": "precipitation_mm",
    "ALLSKY_SFC_SW_DWN": "solar_w_m2",
}


def fetch(url, params):
    response = httpx.get(url, params=params, headers=REQUEST_HEADERS, timeout=10)
    response.raise_for_status()
    return response.json()


def open_meteo(lat, lon, *, timezone=TIMEZONE, **params):
    return fetch(os.getenv("OPEN_METEO_URL", "https://api.open-meteo.com/v1/forecast"), {
        "latitude": lat, "longitude": lon, "timezone": timezone, "wind_speed_unit": "kmh",
        "temperature_unit": "celsius", "precipitation_unit": "mm", **params,
    })


def number(value):
    return value if type(value) in (float, int) and math.isfinite(value) and value > -900 else None


def rows(values, fields):
    for index, instant in enumerate(values["time"]):
        yield instant, {
            field: values[field][index] if field in values else None for field in fields
        }


def mapped(values, fields):
    return {target: number(values.get(source)) for source, target in fields.items()}


def as_utc(time_value, zone):
    return datetime.fromisoformat(time_value).replace(tzinfo=ZoneInfo(zone)).astimezone(UTC)


def rainfall(values, rain="rain", showers="showers"):
    amounts = [number(values.get(key)) for key in (rain, showers)]
    return sum(amounts) if all(amount is not None for amount in amounts) else None


def hourly_rows(values, zone):
    return [
        {"time": as_utc(instant, zone).isoformat(), **mapped(row, HOURLY), "rain_mm": rainfall(row)}
        for instant, row in rows(values, [*HOURLY, "rain", "showers"])
    ]


def current_utc_hour():
    return datetime.now(UTC).replace(minute=0, second=0, microsecond=0)


def forecast(lat, lon, name=None):
    data = open_meteo(lat, lon, forecast_days=7, hourly=",".join([*HOURLY, "rain", "showers"]),
                      daily=",".join([*DAILY, "rain_sum", "showers_sum", "sunrise", "sunset"]))
    daily = [
        {
            "date": day, **mapped(row, DAILY), "rain_mm": rainfall(row, "rain_sum", "showers_sum"),
            **{key: as_utc(row[key], TIMEZONE).isoformat() if row[key] else None for key in ("sunrise", "sunset")},
        }
        for day, row in rows(data["daily"], [*DAILY, "rain_sum", "showers_sum", "sunrise", "sunset"])
    ]
    first_hour = current_utc_hour()
    hourly = [row for row in hourly_rows(data["hourly"], TIMEZONE)
              if datetime.fromisoformat(row["time"]) >= first_hour]
    return {
        "timezone": TIMEZONE, "latitude": lat, "longitude": lon, "location_name": name,
        "daily": daily, "hourly": hourly,
    }


def current(lat, lon):
    fields = [key for key in HOURLY if key not in ("precipitation_probability", "et0_fao_evapotranspiration")]
    values = open_meteo(lat, lon, timezone="UTC", current=",".join([*fields, "rain", "showers", "precipitation"]))["current"]
    interval = number(values.get("interval"))
    rain = rainfall(values)
    precipitation = number(values.get("precipitation"))
    return {
        "time": as_utc(values["time"], "UTC").isoformat(),
        **mapped(values, HOURLY),
        "rain_rate_mmh": rain * 3600 / interval if rain is not None and interval else None,
        "precip_rate_mmh": precipitation * 3600 / interval if precipitation is not None and interval else None,
    }


def recent(lat, lon):
    data = open_meteo(lat, lon, timezone="UTC", past_hours=24, forecast_hours=1,
                      hourly=",".join([*HOURLY, "rain", "showers"]))
    current_hour = current_utc_hour()
    hourly = [row for row in hourly_rows(data["hourly"], "UTC") if datetime.fromisoformat(row["time"]) < current_hour]
    return {"hourly": hourly[-24:], "daily": [], "modeled_history": True}


def agriculture(lat, lon):
    values = open_meteo(lat, lon, timezone="UTC", forecast_hours=24, hourly=",".join(AGRICULTURE))["hourly"]
    hourly = []
    for instant, row in rows(values, AGRICULTURE):
        readings = mapped(row, AGRICULTURE)
        for key in SOIL.values():
            if readings[key] is not None:
                readings[key] = round(readings[key] * 100, 2)
        if any(value is not None for value in readings.values()):
            hourly.append({"time": as_utc(instant, "UTC").isoformat(), **readings})
    return {"hourly": hourly, "soil_profile": "open-meteo"}


def history(lat, lon, start, end):
    data = fetch(os.getenv("NASA_POWER_URL", "https://power.larc.nasa.gov/api/temporal/daily/point"), {
        "latitude": lat, "longitude": lon, "start": start.strftime("%Y%m%d"), "end": end.strftime("%Y%m%d"),
        "parameters": ",".join(ARCHIVE), "community": "AG", "format": "JSON", "time-standard": "UTC",
    })
    parameters = data["properties"]["parameter"]
    units = data.get("parameters", {}).get("ALLSKY_SFC_SW_DWN", {}).get("units", "").lower().replace("-", "")
    timezone = data.get("header", {}).get("time_standard", "UTC")
    daily = []
    for day in sorted({day for name in ARCHIVE for day in parameters.get(name, {})}):
        values = mapped({name: parameters.get(name, {}).get(day) for name in ARCHIVE}, ARCHIVE)
        solar = values["solar_w_m2"]
        # POWER reports solar energy per day, so convert to mean irradiance in watts.
        values["solar_w_m2"] = (
            solar * 1000 / 24 if solar is not None and ("kwh" in units or "kwhr" in units) else None
        )
        if any(value is not None for value in values.values()):
            daily.append({"date": datetime.strptime(day, "%Y%m%d").date().isoformat(), **values})
    return {"daily": daily, "timezone": timezone}
