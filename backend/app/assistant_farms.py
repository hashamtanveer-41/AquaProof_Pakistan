from datetime import UTC, date, datetime, timedelta

from fastapi import HTTPException

from .assistant_access import farmer_scope
from .science import weather
from .science.crops import CROP_NAMES, crop_stage, local_today
from .science.irrigation import IrrigationSettings, Scenario, optimize
from .science.routes import weather_coordinates


def owned_farms(farmer_id):
    with farmer_scope(farmer_id) as connection:
        return connection.execute(
            "SELECT id,name FROM fields WHERE farmer_id=%s AND archived_at IS NULL ORDER BY id",
            (farmer_id,),
        ).fetchall()


def farm_profile(farmer_id, field_id):
    with farmer_scope(farmer_id) as connection:
        farm = connection.execute(
            """SELECT f.id,f.soil,f.source,ST_Area(f.boundary::geography) AS area_m2,
                      ST_X(f.representative_point) AS longitude,ST_Y(f.representative_point) AS latitude,
                      ST_AsGeoJSON(f.boundary)::json AS boundary,
                      s.settings,s.measured_at,c.crop,c.planted
               FROM fields f LEFT JOIN irrigation_settings s ON s.field_id=f.id
               LEFT JOIN LATERAL (
                   SELECT crop,planted FROM crop_seasons
                   WHERE field_id=f.id ORDER BY planted DESC NULLS LAST,id DESC LIMIT 1
               ) c ON true
               WHERE f.id=%s AND f.farmer_id=%s AND f.archived_at IS NULL""",
            (field_id, farmer_id),
        ).fetchone()
    if not farm:
        raise HTTPException(403, "Field is outside the verified farmer scope.")
    crop = CROP_NAMES.get((farm["crop"] or "").casefold())
    farm["stage"] = crop_stage(crop, farm["planted"], local_today()) if crop and farm["planted"] else None
    return farm


def history(farmer_id, field_id):
    farm_profile(farmer_id, field_id)
    with farmer_scope(farmer_id) as conn:
        return {
            "observations": conn.execute(
                """SELECT measurements FROM assistant_observations
                   WHERE field_id=%s AND farmer_id=%s AND status='approved'
                   ORDER BY created_at DESC LIMIT 10""",
                (field_id, farmer_id),
            ).fetchall(),
            "previous_irrigation": conn.execute(
                """SELECT m.parsed FROM farmer_messages m JOIN advisories a ON a.id=m.advisory_id
                   JOIN fields f ON f.id=a.field_id
                   WHERE f.id=%s AND f.farmer_id=%s AND m.approved_at IS NOT NULL
                   ORDER BY m.approved_at DESC LIMIT 10""",
                (field_id, farmer_id),
            ).fetchall(),
        }


def fresh(data, timestamp, maximum_age):
    try:
        value = data[timestamp]
        at = value if isinstance(value, datetime) else datetime.fromisoformat(value)
        age = datetime.now(UTC) - at
        return -timedelta(minutes=5) <= age <= maximum_age
    except (KeyError, ValueError, TypeError):
        return False


def current_weather(farm):
    data = weather.current(weather.point_query(*weather_coordinates(farm)))
    if not fresh(data, "time", timedelta(hours=3)):
        raise HTTPException(502, "Current weather is stale or has no valid timestamp.")
    return data


def fresh_forecast(farm):
    data = weather.forecast(weather.point_query(*weather_coordinates(farm)))
    now = datetime.now(UTC)
    today = local_today()
    # Forecast retrieval time alone cannot prove the forecast covers the current hour.
    hourly = []
    for row in data.get("hourly", []):
        try:
            offset = datetime.fromisoformat(row["time"]) - now
            if -timedelta(hours=2) <= offset <= timedelta(minutes=75):
                hourly.append(row)
        except (KeyError, TypeError, ValueError):
            continue
    if not fresh(data, "retrieved_at", timedelta(minutes=10)) or not hourly:
        raise HTTPException(502, "Forecast does not cover the current hour.")
    rows = [row for row in data["daily"] if date.fromisoformat(row["date"]) >= today]
    if not rows or rows[0]["date"] != today.isoformat() or any(
        row.get(key) is None or row[key] < 0 for row in rows for key in ("rain_mm", "eto_mm")
    ):
        raise HTTPException(502, "Forecast is missing current rainfall or reference ET.")
    return {"source": data["source"], "retrieved_at": data["retrieved_at"],
            "decision_time": now.isoformat(), "daily": rows}


def pump_metrics(volume_m3, settings):
    if not settings.tubewell:
        return None
    # The optimizer already divides net field demand by efficiency to obtain gross volume.
    hours = volume_m3 / settings.tubewell.flow_m3_hour
    return {"hours": round(hours, 2), "pkr": round(hours * settings.tubewell.pkr_hour, 2)}


def recommendation(farm, reports=None):
    missing = []
    crop = CROP_NAMES.get((farm["crop"] or "").casefold())
    if not crop or not farm["planted"]:
        missing.append("crop")
    if not farm["settings"] or not fresh(farm, "measured_at", timedelta(hours=36)):
        missing.append("measurements")
    try:
        forecast = fresh_forecast(farm)
    except HTTPException:
        forecast = None
        missing.append("weather")
    try:
        current = current_weather(farm)
    except HTTPException:
        current = None
    evidence = {"missing": missing, "forecast": forecast, "current": current}
    if missing:
        return evidence
    settings = IrrigationSettings.model_validate(farm["settings"])
    water_source = farm["source"].casefold()
    if ("canal" in water_source and not settings.canal) or ("tubewell" in water_source and not settings.tubewell):
        return {**evidence, "missing": ["supply"]}
    if not any(crop_stage(crop, farm["planted"], date.fromisoformat(row["date"])) not in
               ("Pre-planting", "Beyond modeled season") for row in forecast["daily"]):
        return {**evidence, "missing": ["season"]}
    # Treat all forecast rainfall as uncertain. The second run tests sensitivity to no rain.
    plan = optimize(forecast["daily"], crop, farm["planted"], farm["area_m2"], settings, Scenario())
    dry = optimize(forecast["daily"], crop, farm["planted"], farm["area_m2"], settings, Scenario(rain_factor=0))
    first = plan["plans"][plan["recommended"]]["daily"][0]
    dry_first = dry["plans"][dry["recommended"]]["daily"][0]
    risks = [
        name for name, key, predicate in (
            ("heat", "max_c", lambda v: v >= 40),
            ("frost", "min_c", lambda v: v <= 2),
            ("heavy_rain", "rain_mm", lambda v: v >= 40),
        ) if any(row.get(key) is not None and predicate(row[key]) for row in forecast["daily"][:2])
    ]
    if any(
        row["measurements"].get("soil") == "waterlogged"
        and row["measurements"].get("day") in (
            local_today().isoformat(), (local_today() - timedelta(days=1)).isoformat(),
        )
        for row in (reports or [])
    ):
        risks.append("reported_waterlogging")
    needed = first["canal_m3"] + first["pump_m3"]
    dry_needed = dry_first["canal_m3"] + dry_first["pump_m3"]
    uncertainty = abs(needed - dry_needed) >= max(1, 0.2 * max(needed, dry_needed))
    review = bool(risks or uncertainty or first["unmet_et_mm"] > 0 or first["stress_mm"] > 0)
    return {
        **evidence, "plan": plan, "today": first, "risks": risks,
        "uncertain_rain": uncertainty, "dry_today_m3": dry_needed,
        "requires_review": review, "pump": pump_metrics(first["pump_m3"], settings),
        "canal": settings.canal.model_dump(mode="json") if settings.canal else None,
        "canal_use_hours": round(first["canal_m3"] / settings.canal.flow_m3_hour, 2) if settings.canal else None,
        "farm_inputs": {"area_m2": farm["area_m2"], "soil": farm["soil"], "settings": farm["settings"],
                        "measured_at": farm["measured_at"].isoformat()},
    }


def changed(previous, new):
    if previous.get("missing") or new.get("missing"):
        return previous.get("missing") != new.get("missing")
    first, second = previous["today"], new["today"]
    old_volume = first["canal_m3"] + first["pump_m3"]
    new_volume = second["canal_m3"] + second["pump_m3"]
    weather_before = previous["forecast"]["daily"][0]
    weather_after = new["forecast"]["daily"][0]
    weather_changed = any(
        weather_before.get(key) is not None and weather_after.get(key) is not None
        and abs(weather_before[key] - weather_after[key]) >= threshold
        for key, threshold in (("rain_mm", 8), ("precip_probability_pct", 30), ("max_c", 7))
    )
    old_cost = (previous.get("pump") or {}).get("pkr", 0)
    new_cost = (new.get("pump") or {}).get("pkr", 0)
    return (
        previous["risks"] != new["risks"] or previous["requires_review"] != new["requires_review"]
        or (old_volume > 0) != (new_volume > 0)
        or abs(new_volume - old_volume) >= max(1, .25 * max(old_volume, new_volume))
        or (first["canal_m3"] > 0) != (second["canal_m3"] > 0)
        or weather_changed or abs(old_cost - new_cost) >= max(100, .25 * max(old_cost, new_cost))
    )
