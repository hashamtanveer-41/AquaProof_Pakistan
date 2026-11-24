from datetime import UTC, date, datetime, timedelta
import json
import os

import httpx
from fastapi import APIRouter, HTTPException, Query
from psycopg.types.json import Jsonb

from ..database import connect
from ..assistant_access import queue_field_recheck
from ..registry import field_by_id, require
from . import weather
from .crops import CROP_NAMES, crop_stage
from .irrigation import IrrigationSettings, Scenario, canal_capacity, optimize

router = APIRouter(prefix="/api/fields", tags=["weather and irrigation"])
locations = APIRouter(prefix="/api", tags=["locations"])


@locations.get("/locations")
def locate(q: str = Query(min_length=2, max_length=120)):
    return weather.geocode(q.strip())


def location(connection, field_id):
    return require(connection.execute(
        """SELECT ST_X(representative_point) AS longitude, ST_Y(representative_point) AS latitude
           FROM fields WHERE id = %s AND archived_at IS NULL""",
        (field_id,),
    ).fetchone(), "Field")


def weather_coordinates(point):
    return round(point["latitude"], 5), round(point["longitude"], 5)


@router.get("/{field_id}/weather")
def forecast(field_id: str):
    with connect() as connection:
        point = location(connection, field_id)
        settings = read_settings(connection, field_id)
    result = weather.forecast(weather.point_query(*weather_coordinates(point)))
    return {
        **result,
        **point,
        "daily": [
            {**row, "canal_capacity_m3": canal_capacity(date.fromisoformat(row["date"]), settings, Scenario())
             if settings and settings.canal else None}
            for row in result["daily"]
        ],
    }


@locations.get("/weather/search")
def search_weather(q: str = Query(min_length=2, max_length=120)):
    query = " ".join(q.split())
    if len(query) < 2:
        raise HTTPException(422, "Enter a place name or latitude, longitude.")
    return weather.forecast(query)


@locations.get("/weather/current")
def current_at_location(
    latitude: float = Query(ge=-90, le=90), longitude: float = Query(ge=-180, le=180),
):
    return weather.current(weather.point_query(round(latitude, 5), round(longitude, 5)))


@router.get("/{field_id}/weather/current")
def current_weather(field_id: str):
    with connect() as connection:
        point = location(connection, field_id)
    return weather.current(weather.point_query(*weather_coordinates(point)))


@router.get("/{field_id}/weather/recent")
def recent_weather(field_id: str):
    with connect() as connection:
        point = location(connection, field_id)
    return weather.recent(weather.point_query(*weather_coordinates(point)))


@router.get("/{field_id}/weather/agriculture")
def agricultural_weather(field_id: str):
    with connect() as connection:
        point = location(connection, field_id)
    return weather.agriculture(*weather_coordinates(point))


@router.get("/{field_id}/weather/history")
def historical_weather(field_id: str, start: date | None = None, end: date | None = None):
    latest = datetime.now(UTC).date() - timedelta(days=7)
    end = end or latest
    start = start or end - timedelta(days=6)
    if not date(2000, 1, 1) <= start <= end <= latest or (end - start).days > 30:
        raise HTTPException(422, "Choose up to 31 days from January 1, 2000, ending at least seven days ago.")
    with connect() as connection:
        point = location(connection, field_id)
    return {**point, **weather.history(*weather_coordinates(point), start, end)}


def read_settings(connection, field_id):
    row = connection.execute(
        "SELECT settings FROM irrigation_settings WHERE field_id = %s", (field_id,)
    ).fetchone()
    return IrrigationSettings.model_validate(row["settings"]) if row else None


@router.get("/{field_id}/irrigation-settings")
def get_settings(field_id: str):
    with connect() as connection:
        location(connection, field_id)
        row = connection.execute(
            "SELECT settings,measured_at FROM irrigation_settings WHERE field_id=%s", (field_id,),
        ).fetchone()
        return {**row["settings"], "measured_at": row["measured_at"]} if row else None


@router.put("/{field_id}/irrigation-settings")
def save_settings(field_id: str, settings: IrrigationSettings, measured_at: datetime | None = None):
    if measured_at and (measured_at.tzinfo is None or measured_at > datetime.now(UTC) + timedelta(minutes=5)):
        raise HTTPException(422, "Record the soil-water measurement time with a timezone and within the past.")
    with connect() as connection:
        field = field_by_id(connection, field_id)
        source = field["source"].casefold()
        if (settings.canal and "canal" not in source) or (settings.tubewell and "tubewell" not in source):
            raise HTTPException(422, "Configure only the water sources registered for this field")
        saved = connection.execute(
            """INSERT INTO irrigation_settings (field_id,settings,measured_at) VALUES (%s, %s, %s)
               ON CONFLICT (field_id) DO UPDATE SET settings=excluded.settings,
                   measured_at=CASE
                       WHEN excluded.measured_at IS NOT NULL THEN excluded.measured_at
                       WHEN irrigation_settings.settings->'initial_depletion_mm'=excluded.settings->'initial_depletion_mm'
                        AND irrigation_settings.settings->'initial_surface_depletion_mm'=excluded.settings->'initial_surface_depletion_mm'
                       THEN irrigation_settings.measured_at ELSE NULL END
               RETURNING measured_at""",
            (field_id, Jsonb(settings.model_dump(mode="json")), measured_at),
        ).fetchone()
        queue_field_recheck(connection, field_id)
    return {**settings.model_dump(mode="json"), "measured_at": saved["measured_at"]}


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
    forecast_data = weather.forecast(weather.point_query(*weather_coordinates(point)))
    daily = forecast_data["daily"]
    planted = date.fromisoformat(season["planted"])
    dates = [date.fromisoformat(row["date"]) for row in daily]
    if all(crop_stage(crop, planted, day) in ("Pre-planting", "Beyond modeled season") for day in dates):
        raise HTTPException(409, "The forecast does not overlap the modeled crop season")
    if any(row["rain_mm"] is None or row["eto_mm"] is None or row["rain_mm"] < 0 or row["eto_mm"] < 0 for row in daily):
        raise HTTPException(502, "The forecast did not include usable rainfall and reference ET")
    return {
        **point,
        **optimize(daily, crop, planted, field["acres"] * 4046.8564224, settings, scenario),
        "weather_source": forecast_data["source"],
        "weather_retrieved_at": forecast_data["retrieved_at"],
    }


@router.post("/{field_id}/intelligence")
def farming_intelligence(field_id: str, scenario: Scenario):
    if os.getenv("ASSISTANT_ENABLED", "0") == "1":
        result = simulate(field_id, scenario)
        return {
            "model": "AquaProof scientific engine",
            "explanation": "The plan ranks strategies by crop stress and then pumping cost. The daily amounts, costs, and water constraints are listed in the calculation below.",
            "result": result,
        }
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
