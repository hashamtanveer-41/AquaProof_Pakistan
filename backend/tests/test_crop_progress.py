"""Deterministic unit tests for crop-progress and per-stage water roll-up.

These cover the pure FAO-56 helpers (no database or network): area-to-volume,
runtime formula, stage transitions, pump-flow-missing handling and determinism.
"""

from datetime import date, timedelta
from unittest import TestCase

from app.science.crops import CROPS
from app.science.progress import (
    harvest_window,
    next_irrigation_date,
    runtime_hours,
    season_progress,
    stage_water,
    water_now,
)

WHEAT = CROPS["Wheat"]["lengths"]  # initial 20, development 55, mid 65, late 29 -> 169 days
PLANTED = date(2025, 1, 1)
AREA_M2 = 10_000.0
EFFICIENCY = 0.7


def progress_on(day):
    return season_progress("Wheat", PLANTED, WHEAT, day)


class StageTransitionTest(TestCase):
    def test_current_stage_follows_the_fao56_calendar(self):
        self.assertEqual(progress_on(PLANTED)["current_stage"], "Initial")
        self.assertEqual(progress_on(PLANTED + timedelta(days=20))["current_stage"], "Development")
        self.assertEqual(progress_on(PLANTED + timedelta(days=100))["current_stage"], "Mid-season")
        self.assertEqual(progress_on(PLANTED + timedelta(days=160))["current_stage"], "Late season")

    def test_stage_boundaries_mark_complete_current_upcoming(self):
        stages = {s["name"]: s for s in progress_on(PLANTED + timedelta(days=20))["stages"]}
        self.assertEqual(stages["Initial"]["status"], "complete")
        self.assertEqual(stages["Development"]["status"], "current")
        self.assertEqual(stages["Mid-season"]["status"], "upcoming")
        self.assertEqual(stages["Development"]["day_in_stage"], 1)

    def test_progress_pct_is_elapsed_over_total_season(self):
        self.assertAlmostEqual(progress_on(PLANTED + timedelta(days=20))["progress_pct"], round(20 / 169 * 100, 1))
        self.assertEqual(progress_on(PLANTED - timedelta(days=5))["progress_pct"], 0.0)
        self.assertEqual(progress_on(PLANTED + timedelta(days=500))["progress_pct"], 100.0)

    def test_output_is_deterministic(self):
        self.assertEqual(progress_on(PLANTED + timedelta(days=42)), progress_on(PLANTED + timedelta(days=42)))


class StageWaterMathTest(TestCase):
    def table(self, flow):
        stages = progress_on(PLANTED + timedelta(days=50))["stages"]
        return stage_water(stages, "Wheat", PLANTED, AREA_M2, EFFICIENCY, 5.0, flow)

    def test_volume_is_gross_mm_times_area_over_1000(self):
        # gross_mm is reported rounded to 0.1 mm, so allow the matching ~1 m3 tolerance.
        for row in self.table(50.0):
            self.assertAlmostEqual(row["volume_m3"], row["gross_mm"] * AREA_M2 / 1000, delta=1.0)

    def test_gross_applies_application_efficiency(self):
        row = self.table(50.0)[0]
        self.assertAlmostEqual(row["gross_mm"], round(row["crop_water_mm"] / EFFICIENCY, 1), places=1)

    def test_runtime_is_volume_over_flow(self):
        for row in self.table(50.0):
            self.assertAlmostEqual(row["runtime_hours"] * 50.0, row["volume_m3"], delta=0.5)

    def test_missing_pump_flow_yields_no_runtime_never_a_guess(self):
        self.assertIsNone(runtime_hours(400.0, None))
        self.assertIsNone(runtime_hours(400.0, 0))
        self.assertTrue(all(row["runtime_hours"] is None for row in self.table(None)))


class WaterNowTest(TestCase):
    FIRST = {"date": "2025-06-01", "canal_m3": 100.0, "pump_m3": 300.0, "active_crop": True}

    def test_volume_runtime_and_cost_use_pump_flow(self):
        now = water_now(self.FIRST, AREA_M2, EFFICIENCY, 50.0, 20.0)
        self.assertEqual(now["volume_m3"], 400.0)
        self.assertEqual(now["gross_mm"], 40.0)           # 400 m3 * 1000 / 10000 m2
        self.assertEqual(now["net_mm"], 28.0)             # gross * efficiency
        self.assertEqual(now["runtime_hours"], 6.0)       # pump 300 / 50
        self.assertEqual(now["cost_pkr"], 120.0)          # 6 h * 20 PKR/h
        self.assertEqual(now["source_label"], "forecast")

    def test_without_tubewell_runtime_and_cost_are_absent(self):
        now = water_now(self.FIRST, AREA_M2, EFFICIENCY, None, None)
        self.assertIsNone(now["runtime_hours"])
        self.assertIsNone(now["cost_pkr"])


class NextIrrigationTest(TestCase):
    def test_returns_first_day_with_any_water(self):
        plan = [
            {"date": "2025-06-01", "canal_m3": 0.0, "pump_m3": 0.0},
            {"date": "2025-06-02", "canal_m3": 0.0, "pump_m3": 120.0},
            {"date": "2025-06-03", "canal_m3": 50.0, "pump_m3": 0.0},
        ]
        self.assertEqual(next_irrigation_date(plan), "2025-06-02")

    def test_rain_fed_horizon_without_water_returns_none(self):
        plan = [{"date": "2025-06-01", "canal_m3": 0.0, "pump_m3": 0.0}]
        self.assertIsNone(next_irrigation_date(plan))


def forecast_days(start, rows):
    # rows: list of (rain_mm, precip_probability_pct) from `start` onward.
    return [
        {"date": (start + timedelta(days=i)).isoformat(), "rain_mm": rain, "precip_probability_pct": prob}
        for i, (rain, prob) in enumerate(rows)
    ]


# Wheat modeled maturity is planted + 169 days; late season starts at planted + 140.
MATURITY = PLANTED + timedelta(days=169)


def harvest_on(day, rows):
    return harvest_window("Wheat", PLANTED, WHEAT, day, forecast_days(day, rows))


class HarvestWindowTest(TestCase):
    DRY = [(0.0, 10)] * 5

    def test_immature_crop_is_only_monitored(self):
        result = harvest_on(PLANTED + timedelta(days=50), [(30.0, 90)] * 5)
        self.assertEqual(result["readiness"], "immature")
        self.assertEqual(result["recommendation"], "monitor")
        self.assertEqual(result["modeled_maturity"], MATURITY)

    def test_ripe_crop_with_rain_coming_advises_harvest_before_the_wet_day(self):
        rows = [(0.0, 10), (0.0, 20), (0.0, 15), (12.0, 80), (0.0, 10)]
        result = harvest_on(PLANTED + timedelta(days=170), rows)
        self.assertEqual(result["readiness"], "ready")
        self.assertEqual(result["recommendation"], "harvest_before_rain")
        wet = (PLANTED + timedelta(days=170 + 3)).isoformat()
        self.assertEqual(result["next_wet_date"], wet)
        self.assertEqual(result["harvest_before"], wet)
        self.assertEqual(len(result["dry_days"]), 3)

    def test_ripe_crop_in_a_dry_spell_keeps_the_window_open(self):
        result = harvest_on(PLANTED + timedelta(days=170), self.DRY)
        self.assertEqual(result["recommendation"], "harvest_window_open")
        self.assertFalse(result["rain_coming"])
        self.assertIsNone(result["harvest_before"])

    def test_ripe_crop_already_raining_waits_for_a_dry_break(self):
        result = harvest_on(PLANTED + timedelta(days=170), [(20.0, 95)] + self.DRY)
        self.assertEqual(result["recommendation"], "await_dry_window")
        self.assertEqual(result["dry_days"], [])

    def test_near_maturity_crop_with_rain_is_pulled_forward(self):
        rows = [(0.0, 10), (0.0, 10), (18.0, 85)]
        result = harvest_on(PLANTED + timedelta(days=165), rows)  # 4 days to maturity
        self.assertEqual(result["readiness"], "approaching")
        self.assertEqual(result["recommendation"], "harvest_before_rain")

    def test_early_late_season_is_not_rushed_by_rain(self):
        result = harvest_on(PLANTED + timedelta(days=145), [(18.0, 85)] * 5)  # 24 days out
        self.assertEqual(result["readiness"], "approaching")
        self.assertEqual(result["recommendation"], "prepare")

    def test_is_deterministic(self):
        rows = [(0.0, 10), (12.0, 80)]
        self.assertEqual(harvest_on(MATURITY, rows), harvest_on(MATURITY, rows))
