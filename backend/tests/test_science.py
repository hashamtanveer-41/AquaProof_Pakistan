from datetime import date, timedelta
from unittest import TestCase

from app.science.crops import crop_stage
from app.science.irrigation import CanalTurn, IrrigationSettings, Scenario, Tubewell, apply_decisions, optimize


class IrrigationTest(TestCase):
    def setUp(self):
        self.start = date(2026, 11, 24)
        self.planted = self.start - timedelta(days=65)
        self.forecast = [
            {"date": (self.start + timedelta(days=offset)).isoformat(), "eto_mm": 5, "rain_mm": 0}
            for offset in range(7)
        ]
        self.settings = IrrigationSettings(
            taw_mm=100, initial_depletion_mm=55, allowable_depletion=0.5, efficiency=0.75,
            surface_taw_mm=20, surface_raw_mm=8, initial_surface_depletion_mm=10,
            canal=CanalTurn(first_date=self.start + timedelta(days=2), hours=4, flow_m3_hour=45),
            tubewell=Tubewell(flow_m3_hour=20, hours_per_day=2, pkr_hour=300),
        )

    def run_plan(self, **scenario):
        return optimize(self.forecast, "Wheat", self.planted, 4046.8564224, self.settings, Scenario(**scenario))

    def test_canal_turn_limits_daily_supply_and_delay_moves_it(self):
        result = self.run_plan()
        shifted = self.run_plan(canal_delay_days=2)
        self.assertEqual(result["canal_capacity_m3"], [0, 0, 180, 0, 0, 0, 0])
        self.assertEqual(shifted["canal_capacity_m3"], [0, 0, 0, 0, 180, 0, 0])
        for plan in result["plans"].values():
            for day, capacity in zip(plan["daily"], result["canal_capacity_m3"], strict=True):
                self.assertLessEqual(day["canal_m3"], capacity)
                self.assertLessEqual(day["pump_m3"], 40)
                self.assertLessEqual(day["depletion_mm"], 100)

    def test_tubewell_units_and_cost(self):
        plan = self.run_plan()["plans"]["Tubewell only"]
        volume = sum(day["pump_m3"] for day in plan["daily"])
        self.assertGreater(volume, 0)
        self.assertAlmostEqual(plan["cost_pkr"], volume / 20 * 300, delta=0.6)
        doubled = self.run_plan(pump_pkr_hour=600)["plans"]["Tubewell only"]
        self.assertAlmostEqual(doubled["cost_pkr"], plan["cost_pkr"] * 2, delta=0.1)

    def test_mixed_sources_can_reduce_stress_and_cost(self):
        plans = self.run_plan()["plans"]
        self.assertLess(plans["Canal and tubewell"]["stress_score"], plans["No irrigation"]["stress_score"])
        self.assertLess(plans["Canal and tubewell"]["cost_pkr"], plans["Tubewell only"]["cost_pkr"])

    def test_heavy_rain_cannot_result_in_negative_depletion(self):
        rainy = [{**day, "rain_mm": 100} for day in self.forecast]
        plans = optimize(rainy, "Wheat", self.planted, 4046.8564224, self.settings, Scenario())["plans"]
        self.assertTrue(all(day["depletion_mm"] == 0 for day in plans["No irrigation"]["daily"]))

    def test_unmet_crop_demand_starts_only_when_root_zone_is_exhausted(self):
        dry = [{**day, "eto_mm": 12} for day in self.forecast]
        days = optimize(dry, "Wheat", self.planted, 4046.8564224, self.settings, Scenario())["plans"]["No irrigation"]["daily"]
        self.assertEqual(days[0]["unmet_et_mm"], 0)
        shortages = [day for day in days if day["unmet_et_mm"] > 0]
        self.assertTrue(shortages)
        self.assertTrue(all(day["depletion_mm"] == 100 for day in shortages))

    def test_first_stage_and_modeled_season_boundaries(self):
        self.assertEqual(crop_stage("Wheat", self.start, self.start - timedelta(days=1)), "Pre-planting")
        self.assertEqual(crop_stage("Wheat", self.start, self.start + timedelta(days=20)), "Development")
        self.assertEqual(crop_stage("Wheat", self.start, self.start + timedelta(days=169)), "Beyond modeled season")

    def test_no_irrigation_after_modeled_harvest(self):
        planted = self.start - timedelta(days=167)
        result = optimize(self.forecast, "Wheat", planted, 4046.8564224, self.settings, Scenario())
        for plan in result["plans"].values():
            self.assertTrue(all(day["canal_m3"] == day["pump_m3"] == 0 for day in plan["daily"][2:]))

    def test_daily_decisions_lock_water_volumes_and_recalculate_depletion(self):
        result = self.run_plan()
        baseline = result["plans"][result["recommended"]]["daily"]
        day = baseline[0]["date"]
        skipped, conflicts = apply_decisions(baseline, 4046.8564224, self.settings, Scenario(), {
            day: {"action": "skip", "canal_m3": 0, "pump_m3": 0},
        })
        self.assertFalse(conflicts)
        self.assertEqual(skipped["daily"][0]["pump_m3"], 0)
        self.assertGreater(skipped["daily"][0]["depletion_mm"], baseline[0]["depletion_mm"])
        adjusted, conflicts = apply_decisions(baseline, 4046.8564224, self.settings, Scenario(), {
            day: {"action": "edit", "canal_m3": 0, "pump_m3": 20},
        })
        self.assertFalse(conflicts)
        self.assertEqual(adjusted["daily"][0]["pump_m3"], 20)
        self.assertLess(adjusted["daily"][0]["depletion_mm"], skipped["daily"][0]["depletion_mm"])

    def test_a_canal_delay_surfaces_a_conflict_with_an_accepted_turn(self):
        result = self.run_plan()
        baseline = result["plans"][result["recommended"]]["daily"]
        day = baseline[2]["date"]
        reviewed, conflicts = apply_decisions(baseline, 4046.8564224, self.settings, Scenario(canal_delay_days=2), {
            day: {"action": "accept", "canal_m3": 150, "pump_m3": 0},
        })
        self.assertIsNone(reviewed)
        self.assertEqual(conflicts, [day])
