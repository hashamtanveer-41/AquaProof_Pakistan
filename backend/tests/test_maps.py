from datetime import date
from unittest import TestCase
from app.registry import irrigation_status


class MapIrrigationStatusTest(TestCase):
    def test_irrigation_colors_follow_the_saved_supply_and_local_calendar(self):
        today = date(2026, 11, 24)
        settings = {"canal": {"first_date": "2026-11-17", "cycle_days": 7}}
        self.assertEqual(irrigation_status("Canal", settings, today), "canal_today")
        self.assertEqual(irrigation_status("Canal", settings, date(2026, 11, 25)), "configured")
        self.assertEqual(irrigation_status("Canal + Tubewell", settings, date(2026, 11, 25)), "setup_required")
        self.assertEqual(irrigation_status("Rain-fed", None, today), "rain_fed")
