from datetime import date, timedelta
from typing import Annotated

import numpy as np
from pydantic import Field, model_validator
from scipy.optimize import linprog

from ..registry import Input
from .crops import crop_parameters, crop_stage

NonNegative = Annotated[float, Field(ge=0, le=1e9, allow_inf_nan=False)]


class CanalTurn(Input):
    first_date: date
    cycle_days: int = Field(default=7, ge=1, le=60)
    hours: float = Field(gt=0, le=24, allow_inf_nan=False)
    flow_m3_hour: float = Field(gt=0, le=100000, allow_inf_nan=False)


class Tubewell(Input):
    flow_m3_hour: float = Field(gt=0, le=100000, allow_inf_nan=False)
    hours_per_day: float = Field(gt=0, le=24, allow_inf_nan=False)
    pkr_hour: NonNegative


class IrrigationSettings(Input):
    taw_mm: float = Field(gt=0, le=1200, allow_inf_nan=False)
    initial_depletion_mm: NonNegative
    allowable_depletion: float = Field(gt=0, lt=1, allow_inf_nan=False)
    efficiency: float = Field(gt=0, le=1, allow_inf_nan=False)
    surface_taw_mm: float = Field(gt=0, le=80, allow_inf_nan=False)
    surface_raw_mm: NonNegative
    initial_surface_depletion_mm: NonNegative
    canal: CanalTurn | None = None
    tubewell: Tubewell | None = None

    @model_validator(mode="after")
    def validate_balance(self):
        if self.initial_depletion_mm > self.taw_mm:
            raise ValueError("Root-zone depletion cannot exceed total available water")
        if self.surface_raw_mm >= self.surface_taw_mm or self.initial_surface_depletion_mm > self.surface_taw_mm:
            raise ValueError("Surface water settings exceed available surface water")
        return self


class Scenario(Input):
    rain_factor: float = Field(default=1, ge=0, le=3, allow_inf_nan=False)
    canal_delay_days: int = Field(default=0, ge=0, le=60)
    pump_pkr_hour: NonNegative | None = None


def crop_demand(forecast, crop, planted, settings, rain_factor):
    """Estimate potential ET with the PI-Advisor surface drying and crop coefficients."""
    surface = settings.initial_surface_depletion_mm
    daily = []
    for day in forecast:
        when = date.fromisoformat(day["date"])
        kcb, cover = crop_parameters(crop, planted, when)
        stage = crop_stage(crop, planted, when)
        rain = day["rain_mm"] * rain_factor
        reduction = 1 if surface <= settings.surface_raw_mm else (
            (settings.surface_taw_mm - surface) / (settings.surface_taw_mm - settings.surface_raw_mm)
        )
        kc_max = max(1.2, kcb + 0.05)
        evaporation = day["eto_mm"] * min(reduction * (kc_max - kcb), (1 - cover) * kc_max)
        surface = min(settings.surface_taw_mm, max(0, surface - rain) + evaporation)
        daily.append({
            "date": day["date"],
            "rain_mm": rain,
            "eto_mm": day["eto_mm"],
            "crop_et_mm": kcb * day["eto_mm"] + evaporation,
            "stage": stage,
            "active_crop": stage not in ("Pre-planting", "Beyond modeled season"),
        })
    return daily


def canal_capacity(day, settings, scenario):
    canal = settings.canal
    if not canal:
        return 0
    opening = canal.first_date + timedelta(days=scenario.canal_delay_days)
    offset = (day - opening).days
    return canal.flow_m3_hour * canal.hours if offset >= 0 and offset % canal.cycle_days == 0 else 0


def solve_plan(days, bounds_canal, bounds_pump, settings, net_mm_to_volume, price):
    count = len(days)
    # Each day allocates net depth from canal and pump and tracks the root zone balance.
    canal, pump, deficit, drain, stress, unmet, dry = np.arange(count * 7).reshape(7, count)
    equalities = np.zeros((count, count * 7))
    limits = np.zeros((count * 3, count * 7))
    rhs = []
    for i, day in enumerate(days):
        equalities[i, [canal[i], pump[i], deficit[i], drain[i], unmet[i]]] = [1, 1, 1, -1, 1]
        if i:
            equalities[i, deficit[i - 1]] = -1
        previous = 0 if i else settings.initial_depletion_mm
        rhs.append(previous + day["crop_et_mm"] - day["rain_mm"])
        limits[i, [deficit[i], stress[i]]] = [1, -1]
        # Unmet demand is possible only when the root zone is exhausted.
        limits[i + count, [unmet[i], dry[i]]] = [1, -day["crop_et_mm"]]
        limits[i + count * 2, [deficit[i], dry[i]]] = [-1, settings.taw_mm]

    raw = settings.taw_mm * settings.allowable_depletion
    bounds = (
        [(0, capacity / net_mm_to_volume if day["active_crop"] else 0)
         for capacities in (bounds_canal, bounds_pump)
         for day, capacity in zip(days, capacities, strict=True)]
        + [(0, settings.taw_mm)] * count + [(0, None)] * (2 * count)
        + [(0, day["crop_et_mm"]) for day in days]
        + [(0, 1)] * count
    )
    risk = np.zeros(count * 7)
    risk[stress] = [int(day["active_crop"]) for day in days]
    risk[unmet] = [2 if day["active_crop"] else 0 for day in days]
    integral = np.zeros(count * 7, dtype=int)
    integral[dry] = 1
    common = {"A_eq": equalities, "b_eq": rhs, "bounds": bounds, "method": "highs", "integrality": integral}
    upper = [raw] * count + [0] * (count * 2)

    # Solve crop risk first. Among equally safe plans, prefer lower pumping cost.
    safest = linprog(risk, A_ub=limits, b_ub=upper, **common)
    if not safest.success:
        raise RuntimeError(safest.message)
    cost = np.zeros(count * 7)
    cost[canal] = 1e-4
    cost[pump] = price * net_mm_to_volume + 2e-4
    cost[drain] = 1e-4
    cost[unmet] = 1e-4
    chosen = linprog(
        cost,
        A_ub=np.vstack((limits, risk)),
        b_ub=upper + [safest.fun + 1e-7],
        **common,
    )
    if not chosen.success:
        raise RuntimeError(chosen.message)

    def value(group, i):
        return max(0.0, float(chosen.x[group[i]]))

    return {
        "cost_pkr": round(sum(chosen.x[pump]) * net_mm_to_volume * price, 2),
        "stress_score": round(float(risk @ chosen.x), 3),
        "daily": [{
            **day,
            "canal_m3": round(value(canal, i) * net_mm_to_volume, 2),
            "pump_m3": round(value(pump, i) * net_mm_to_volume, 2),
            "depletion_mm": round(value(deficit, i), 2),
            "stress_mm": round(value(stress, i), 2) if day["active_crop"] else 0,
            "unmet_et_mm": round(value(unmet, i), 2),
        } for i, day in enumerate(days)],
    }


def optimize(forecast, crop, planted, area_m2, settings, scenario):
    days = crop_demand(forecast, crop, planted, settings, scenario.rain_factor)
    canal = [canal_capacity(date.fromisoformat(day["date"]), settings, scenario) for day in days]
    pump = settings.tubewell
    pump_capacity = [pump.flow_m3_hour * pump.hours_per_day if pump else 0] * len(days)
    zeros = [0] * len(days)
    price = 0 if not pump else (
        pump.pkr_hour if scenario.pump_pkr_hour is None else scenario.pump_pkr_hour
    ) / pump.flow_m3_hour
    net_mm_to_volume = area_m2 / 1000 / settings.efficiency
    plans = {}
    for label, available_canal, available_pump in [
        ("No irrigation", zeros, zeros),
        ("Canal only", canal, zeros),
        ("Tubewell only", zeros, pump_capacity),
        ("Canal and tubewell", canal, pump_capacity),
    ]:
        if label == "No irrigation" or (
            (label not in ("Canal only", "Canal and tubewell") or settings.canal)
            and (label not in ("Tubewell only", "Canal and tubewell") or pump)
        ):
            plans[label] = solve_plan(days, available_canal, available_pump, settings, net_mm_to_volume, price)
    best = min(plans, key=lambda label: (
        plans[label]["stress_score"],
        plans[label]["cost_pkr"],
        sum(day["canal_m3"] + day["pump_m3"] for day in plans[label]["daily"]),
    ))
    return {
        "recommended": best,
        "plans": plans,
        "canal_capacity_m3": canal,
        "readily_available_mm": settings.taw_mm * settings.allowable_depletion,
        "crop": crop,
        "planted": planted.isoformat(),
    }
