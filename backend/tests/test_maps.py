from datetime import date
from unittest import TestCase
from unittest.mock import patch

from fastapi import HTTPException

from app.maps import map_config, require_tracing_authorization
from app.registry import irrigation_status


class MapConfigurationTest(TestCase):
    def test_browser_key_and_tracing_permission_are_independent(self):
        with patch.dict("os.environ", {"MAPTILER_API_KEY": "local-test-key", "MAPTILER_TRACING_AUTHORIZED": "0"}):
            self.assertEqual(map_config(), {"api_key": "local-test-key", "tracing_authorized": False})
            with self.assertRaises(HTTPException) as failure:
                require_tracing_authorization()
        self.assertEqual(failure.exception.status_code, 403)
        with patch.dict("os.environ", {"MAPTILER_TRACING_AUTHORIZED": "1"}):
            require_tracing_authorization()

    def test_irrigation_colors_follow_the_saved_supply_and_local_calendar(self):
        today = date(2026, 11, 24)
        settings = {"canal": {"first_date": "2026-11-17", "cycle_days": 7}}
        self.assertEqual(irrigation_status("Canal", settings, today), "canal_today")
        self.assertEqual(irrigation_status("Canal", settings, date(2026, 11, 25)), "configured")
        self.assertEqual(irrigation_status("Canal + Tubewell", settings, date(2026, 11, 25)), "setup_required")
        self.assertEqual(irrigation_status("Rain-fed", None, today), "rain_fed")
