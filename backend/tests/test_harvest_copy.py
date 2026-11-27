"""Harvest advisory copy: language coverage, date rendering and alert gating."""

from datetime import date
from unittest import TestCase

from app import assistant_copy as copy

LANGUAGES = ("en", "ur", "roman_ur")
READY = {
    "recommendation": "harvest_before_rain",
    "modeled_maturity": date(2025, 4, 15),
    "next_wet_date": "2025-04-10",
    "harvest_before": "2025-04-10",
}


class HarvestCopyTest(TestCase):
    def test_every_language_renders_each_recommendation(self):
        codes = ("monitor", "prepare", "harvest_before_rain", "await_dry_window", "harvest_window_open")
        for language in LANGUAGES:
            for code in codes:
                text = copy.harvest_report(language, {**READY, "recommendation": code})
                self.assertTrue(text.strip())
                self.assertIn(copy.COPY[language]["harvest_check"], text)

    def test_rain_warning_includes_the_wet_date(self):
        self.assertIn("2025-04-10", copy.harvest_report("en", READY))

    def test_alert_only_fires_for_actionable_states(self):
        self.assertTrue(copy.harvest_alert("en", READY))
        self.assertEqual(copy.harvest_alert("en", {"recommendation": "monitor"}), "")
        self.assertEqual(copy.harvest_alert("ur", {"recommendation": "prepare"}), "")

    def test_missing_inputs_ask_instead_of_guessing(self):
        text = copy.harvest_report("en", {"missing": ["crop"]})
        self.assertIn(copy.COPY["en"]["missing_prefix"], text)
