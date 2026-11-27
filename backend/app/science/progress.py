"""Deterministic crop-progress and per-stage water roll-up for the officer workspace.

These helpers are pure: they take already-fetched registry, settings and forecast
values and return JSON-ready dictionaries. All irrigation physics reuses the
FAO-56 engine in ``irrigation.py`` and the crop coefficients in ``crops.py`` so
the same inputs always produce identical outputs. Weather and database access stay
in ``routes.py`` to keep this module easy to unit test.
"""

from datetime import date, timedelta

from .crops import STAGE_LABELS, STAGES, crop_parameters, crop_stage

# FAO-56 gross volume for a net depth in millimetres over a field area in m2.
# Gross applies application efficiency; volume = mm * m2 / 1000.
MM_M2_PER_M3 = 1000.0


def stage_bounds(crop, planted, lengths):
    start = planted
    bounds = []
    for key, label in zip(STAGES, STAGE_LABELS, strict=True):
        length = lengths[key]
        bounds.append({"key": key, "name": label, "starts_on": start,
                       "ends_before": start + timedelta(days=length), "length_days": length})
        start = bounds[-1]["ends_before"]
    return bounds, start


def representative_kc(crop, planted, stage):
    # Basal crop coefficient at the stage midpoint. FAO-56 dual-Kc basal value.
    midpoint = stage["starts_on"] + timedelta(days=max(0, stage["length_days"] // 2))
    kcb, _cover = crop_parameters(crop, planted, midpoint)
    return round(kcb, 2)


def season_progress(crop, planted, lengths, today):
    """Four-stage timeline with the current stage, day-in-stage and percent progress."""
    bounds, maturity = stage_bounds(crop, planted, lengths)
    total_days = (maturity - planted).days
    elapsed = (today - planted).days
    progress_pct = round(min(100.0, max(0.0, elapsed / total_days * 100)), 1) if total_days else 0.0
    current_label = crop_stage(crop, planted, today)
    stages = []
    for stage in bounds:
        if today >= stage["ends_before"]:
            status, day_in_stage, stage_pct = "complete", stage["length_days"], 100.0
        elif today >= stage["starts_on"]:
            day_in_stage = (today - stage["starts_on"]).days + 1
            status = "current"
            stage_pct = round(min(100.0, day_in_stage / stage["length_days"] * 100), 1) if stage["length_days"] else 0.0
        else:
            status, day_in_stage, stage_pct = "upcoming", 0, 0.0
        stages.append({
            "name": stage["name"], "starts_on": stage["starts_on"], "ends_before": stage["ends_before"],
            "length_days": stage["length_days"], "status": status, "day_in_stage": day_in_stage,
            "progress_pct": stage_pct, "kc": representative_kc(crop, planted, stage),
        })
    current = next((stage for stage in stages if stage["status"] == "current"), None)
    return {
        "current_stage": current_label,
        "day_in_stage": current["day_in_stage"] if current else 0,
        "progress_pct": progress_pct,
        "modeled_maturity": maturity,
        "season_length_days": total_days,
        "stages": stages,
        # The crop calendar is a generic FAO-56 / PI-Advisor model, not a field measurement.
        "confidence": "modeled",
        "source": "synthetic",
    }


def runtime_hours(volume_m3, flow_m3_hour):
    """Tubewell runtime in hours. Returns None when pump flow is unknown (ask, never guess)."""
    if not flow_m3_hour or flow_m3_hour <= 0:
        return None
    return round(volume_m3 / flow_m3_hour, 2)


def stage_water(stages, crop, planted, area_m2, efficiency, reference_eto_mm, flow_m3_hour):
    """Per-stage crop water requirement: Kc -> ETc -> gross depth -> volume -> runtime.

    ``reference_eto_mm`` is a single representative daily ET0 (e.g. the forecast mean),
    labelled by the caller. Stage totals are planning estimates of gross crop water
    requirement, not a post-rain root-zone balance (that is the live ``water_now`` block).
    """
    rows = []
    for stage in stages:
        kc = stage["kc"]
        etc_per_day = kc * reference_eto_mm
        stage_total_mm = etc_per_day * stage["length_days"]
        gross_mm = stage_total_mm / efficiency
        volume_m3 = gross_mm * area_m2 / MM_M2_PER_M3
        rows.append({
            "name": stage["name"], "length_days": stage["length_days"], "kc": kc,
            "etc_mm_per_day": round(etc_per_day, 2), "crop_water_mm": round(stage_total_mm, 1),
            "gross_mm": round(gross_mm, 1), "volume_m3": round(volume_m3, 1),
            "runtime_hours": runtime_hours(volume_m3, flow_m3_hour),
            "basis": "synthetic",
        })
    return rows


def next_irrigation_date(daily_plan, *, threshold_m3=0.01):
    """First recommended day in the forecast horizon with any canal or pump water."""
    for day in daily_plan:
        if day["canal_m3"] + day["pump_m3"] > threshold_m3:
            return day["date"]
    return None


# Harvest rain-risk thresholds. A day is "wet" (bad for cutting/drying a ripe crop) when
# complete local-day rainfall or the daily precipitation probability crosses these.
HARVEST_RAIN_MM = 5.0
HARVEST_RAIN_PROB_PCT = 50
# A crop at or past modeled maturity stays in the harvest window for this many days.
HARVEST_READY_WINDOW_DAYS = 21
# How close to modeled maturity a late-stage crop must be before rain triggers "harvest now".
HARVEST_NEAR_MATURITY_DAYS = 10


def _wet_day(row):
    return (row.get("rain_mm") or 0) >= HARVEST_RAIN_MM or (
        row.get("precip_probability_pct") or 0) >= HARVEST_RAIN_PROB_PCT


def harvest_window(crop, planted, lengths, today, forecast_daily):
    """Compare modeled crop maturity against the rain forecast to time the harvest.

    Deterministic. Maturity comes from the FAO-56 stage calendar (labelled synthetic);
    rainfall is the complete local-day forecast (labelled forecast). It never claims a
    crop is dry or ripe with certainty — it flags the window and asks for a field check.
    """
    bounds, maturity = stage_bounds(crop, planted, lengths)
    late_start = bounds[-1]["starts_on"]
    days_to_maturity = (maturity - today).days
    if today < late_start:
        readiness = "immature"
    elif today < maturity:
        readiness = "approaching"
    elif today <= maturity + timedelta(days=HARVEST_READY_WINDOW_DAYS):
        readiness = "ready"
    else:
        readiness = "overdue"

    upcoming = []
    for row in forecast_daily:
        try:
            if date.fromisoformat(row["date"]) >= today:
                upcoming.append(row)
        except (KeyError, TypeError, ValueError):
            continue
    dry_days = []
    next_wet_date = None
    for row in upcoming:
        if _wet_day(row):
            next_wet_date = row["date"]
            break
        dry_days.append(row["date"])
    rain_coming = next_wet_date is not None
    have_forecast = bool(upcoming)

    # Only drive a rain-forced harvest when the crop is actually close to ripe.
    near_ripe = readiness in ("ready", "overdue") or (
        readiness == "approaching" and days_to_maturity <= HARVEST_NEAR_MATURITY_DAYS)
    if readiness == "immature":
        recommendation = "monitor"
    elif not have_forecast:
        recommendation = "harvest_window_open" if readiness in ("ready", "overdue") else "prepare"
    elif near_ripe and rain_coming and dry_days:
        recommendation = "harvest_before_rain"
    elif near_ripe and rain_coming:
        recommendation = "await_dry_window"
    elif readiness in ("ready", "overdue"):
        recommendation = "harvest_window_open"
    else:
        recommendation = "prepare"

    return {
        "readiness": readiness,
        "recommendation": recommendation,
        "current_stage": crop_stage(crop, planted, today),
        "modeled_maturity": maturity,
        "days_to_maturity": days_to_maturity,
        "rain_coming": rain_coming,
        "next_wet_date": next_wet_date,
        "dry_days": dry_days,
        "harvest_before": next_wet_date if recommendation == "harvest_before_rain" else None,
        "forecast_available": have_forecast,
        "confidence": "modeled",
        "source": "synthetic",
    }


def water_now(first_day, area_m2, efficiency, flow_m3_hour, pkr_hour):
    """Live 'water needed now' from the optimizer's first forecast day."""
    volume_m3 = round(first_day["canal_m3"] + first_day["pump_m3"], 2)
    gross_mm = round(volume_m3 * MM_M2_PER_M3 / area_m2, 2) if area_m2 else 0.0
    hours = runtime_hours(first_day["pump_m3"], flow_m3_hour)
    return {
        "date": first_day["date"],
        "net_mm": round(gross_mm * efficiency, 2),
        "gross_mm": gross_mm,
        "canal_m3": first_day["canal_m3"],
        "pump_m3": first_day["pump_m3"],
        "volume_m3": volume_m3,
        "runtime_hours": hours,
        "cost_pkr": round(hours * pkr_hour, 2) if hours is not None and pkr_hour is not None else None,
        # Forecast-driven demand. Rainfall is treated as uncertain by the engine.
        "source_label": "forecast",
    }
