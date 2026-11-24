from datetime import date, timedelta
import json
import os

import httpx
from fastapi import APIRouter, HTTPException, Query
from psycopg.types.json import Jsonb

from ..database import connect
from ..registry import field_by_id, require
from . import weather
from .crops import CROP_NAMES, crop_stage, local_today
from .irrigation import IrrigationSettings, Scenario, canal_capacity, optimize

router = APIRouter(prefix="/api/fields", tags=["weather and irrigation"])
locations = APIRouter(prefix="/api", tags=["locations"])


@locations.get("/locations")
def locate(q: str = Query(min_length=2, max_length=120)):
    return weather.geocode(q.strip())


def location(connection, field_id):
    return require(connection.execute(
        """SELECT ST_X(p.point) AS longitude, ST_Y(p.point) AS latitude
           FROM fields CROSS JOIN LATERAL (SELECT ST_PointOnSurface(boundary) AS point) p
           WHERE id = %s""",
        (field_id,),
    ).fetchone(), "Field")


def weather_coordinates(point):
    return round(point["latitude"], 5), round(point["longitude"], 5)


@router.get("/{field_id}/weather")
def forecast(field_id: str):
    with connect() as connection:
        point = location(connection, field_id)
        settings = read_settings(connection, field_id)
    daily = weather.forecast(*weather_coordinates(point))
    return {
        **point,
        "source": "Open-Meteo",
        "daily": [
            {**row, "canal_capacity_m3": canal_capacity(date.fromisoformat(row["date"]), settings, Scenario())
             if settings and settings.canal else None}
            for row in daily
        ],
    }


@router.get("/{field_id}/weather/history")
def historical_weather(field_id: str, start: date | None = None, end: date | None = None):
    today = local_today()
    end = end or today - timedelta(days=7)
    start = start or end - timedelta(days=6)
    if not date(2001, 1, 1) <= start <= end < today or (end - start).days > 30:
        raise HTTPException(422, "Choose up to 31 past days on or after January 1, 2001")
    with connect() as connection:
        point = location(connection, field_id)
    return {**point, "source": "NASA POWER", "daily": weather.history(*weather_coordinates(point), start, end)}


def read_settings(connection, field_id):
    row = connection.execute(
        "SELECT settings FROM irrigation_settings WHERE field_id = %s", (field_id,)
    ).fetchone()
    return IrrigationSettings.model_validate(row["settings"]) if row else None


@router.get("/{field_id}/irrigation-settings")
def get_settings(field_id: str):
    with connect() as connection:
        location(connection, field_id)
        return read_settings(connection, field_id)


@router.put("/{field_id}/irrigation-settings")
def save_settings(field_id: str, settings: IrrigationSettings):
    with connect() as connection:
        field = field_by_id(connection, field_id)
        source = field["source"].casefold()
        if (settings.canal and "canal" not in source) or (settings.tubewell and "tubewell" not in source):
            raise HTTPException(422, "Configure only the water sources registered for this field")
        connection.execute(
            """INSERT INTO irrigation_settings VALUES (%s, %s)
               ON CONFLICT (field_id) DO UPDATE SET settings = excluded.settings""",
            (field_id, Jsonb(settings.model_dump(mode="json"))),
        )
    return settings


@router.post("/{field_id}/simulate")
@router.post("/{field_id}/optimize")
def simulate(field_id: str, scenario: Scenario):
    with connect() as connection:
        field = field_by_id(connection, field_id)
        point = location(connection, field_id)
        settings = read_settings(connection, field_id)
    if not settings:
        raise HTTPException(409, "Save the field's irrigation settings before running a scenario")
    if not field["seasons"] or not field["seasons"][0]["planted"]:
        raise HTTPException(409, "Record the crop and planting date in Crop Monitoring")
    season = field["seasons"][0]
    crop = CROP_NAMES.get(season["crop"].casefold())
    if not crop:
        raise HTTPException(422, "No PI-Advisor crop calendar is available for this crop")
    daily = weather.forecast(*weather_coordinates(point))
    planted = date.fromisoformat(season["planted"])
    dates = [date.fromisoformat(row["date"]) for row in daily]
    if all(crop_stage(crop, planted, day) in ("Pre-planting", "Beyond modeled season") for day in dates):
        raise HTTPException(409, "The forecast does not overlap the modeled crop season")
    if any(row["rain_mm"] is None or row["eto_mm"] is None or row["rain_mm"] < 0 or row["eto_mm"] < 0 for row in daily):
        raise HTTPException(502, "The forecast did not include usable rainfall and reference ET")
    return {
        **point,
        **optimize(daily, crop, planted, field["acres"] * 4046.8564224, settings, scenario),
        "weather_source": "Open-Meteo",
    }


@router.post("/{field_id}/intelligence")
def farming_intelligence(field_id: str, scenario: Scenario):
    base_url, model = os.getenv("OPENAI_BASE_URL"), os.getenv("OPENAI_MODEL")
    if not base_url or not model:
        raise HTTPException(503, "Configure a farming intelligence model endpoint to generate an explanation")
    result = simulate(field_id, scenario)
    strategy = result["recommended"]
    context = {
        "crop": result["crop"],
        "planted": result["planted"],
        "recommended": strategy,
        "readily_available_mm": result["readily_available_mm"],
        "weather_source": result["weather_source"],
        "scenario": scenario.model_dump(),
        "plan": result["plans"][strategy],
        "strategy_comparison": {
            label: {key: plan[key] for key in ("cost_pkr", "stress_score")}
            for label, plan in result["plans"].items()
        },
    }
    key = os.getenv("OPENAI_API_KEY")
    try:
        response = httpx.post(
            f"{base_url.rstrip('/')}/chat/completions",
            headers={"Authorization": f"Bearer {key}"} if key else {},
            timeout=40,
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": "Explain the supplied irrigation plan for an agricultural officer. Use only the supplied observations and modeled scenario. State the recommended timing, water amounts, pumping cost and risks. Distinguish forecast and scenario inputs. Do not invent field observations, instructions, dates or estimates."},
                    {"role": "user", "content": json.dumps(context, ensure_ascii=False)},
                ],
            },
        )
        response.raise_for_status()
        explanation = response.json()["choices"][0]["message"]["content"]
        if not isinstance(explanation, str) or not explanation.strip():
            raise ValueError("Empty model response")
    except (httpx.HTTPError, ValueError, TypeError, KeyError, IndexError) as error:
        raise HTTPException(502, "The farming intelligence model could not explain this plan.") from error
    return {"model": model, "explanation": explanation.strip(), "result": result}
