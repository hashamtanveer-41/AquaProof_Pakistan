from datetime import UTC, date, datetime, timedelta
from unittest import TestCase
from unittest.mock import patch

import httpx
from fastapi import HTTPException

from app.science import openweather, weather
from app.service_http import ProviderError


class WeatherTest(TestCase):
    def setUp(self):
        cache = patch.object(weather, "_cache", weather.OrderedDict())
        cache.start()
        self.addCleanup(cache.stop)

    def test_openweather_normalizes_three_hour_periods_and_partials(self):
        instant = datetime(2026, 11, 24, 18, tzinfo=UTC)
        first = {
            "dt": int(instant.timestamp()), "main": {"temp": 17, "humidity": 45},
            "wind": {"speed": 4, "gust": 5}, "rain": {"3h": 3}, "pop": .55, "visibility": 9000,
        }
        second = {"dt": first["dt"] + 10800, "main": {"temp": 21}}
        result = openweather.forecast_payload({"list": [first, second]}, 31.52, 74.36, "Lahore")
        self.assertEqual(result["interval_hours"], 3)
        self.assertEqual([row["date"] for row in result["daily"]], ["2026-11-24", "2026-11-25"])
        single = result["hourly"][0]
        self.assertEqual(single["rain_rate_mmh"], 1)
        self.assertEqual(single["precip_probability_pct"], 55)
        self.assertEqual(single["wind_kmh"], 14.4)
        self.assertEqual(single["visibility_km"], 9)
        self.assertEqual(result["daily"][1]["rain_mm"], 0)
        self.assertIsNone(result["daily"][0]["eto_mm"])

    def test_openweather_key_is_only_passed_to_provider_and_errors_are_safe(self):
        with (
            patch.dict("os.environ", {"OPENWEATHER_API_KEY": "fixture-only"}),
            patch.object(httpx, "request", return_value=httpx.Response(401)) as send,
            self.assertRaises(ProviderError) as failure,
        ):
            openweather.current(31.52, 74.36)
        self.assertEqual(failure.exception.status, 401)
        self.assertIn("/weather", str(failure.exception))
        self.assertNotIn("fixture-only", str(failure.exception))
        self.assertEqual(send.call_args.kwargs["params"]["appid"], "fixture-only")

    def test_irrigation_forecast_uses_complete_daily_depths_and_reference_et(self):
        daily = {"date": datetime.now(weather.LOCAL_ZONE).date().isoformat(), "rain_mm": 2, "eto_mm": 2.2}
        valid = {"daily": [daily], "hourly": [{"time": datetime.now(UTC).isoformat()}]}
        with (
            patch.object(openweather, "forecast") as primary,
            patch.object(weather.backup, "forecast", return_value=valid),
        ):
            result = weather.irrigation_forecast("31.52,74.36")
        primary.assert_not_called()
        self.assertEqual(result["source"], "Open-Meteo")
        self.assertEqual(result["daily"][0]["eto_mm"], 2.2)

    def test_irrigation_rejects_missing_reference_et(self):
        day = datetime.now(weather.LOCAL_ZONE).date().isoformat()
        with (
            patch.object(weather.backup, "forecast", return_value={
                "daily": [{"date": day, "rain_mm": 0, "eto_mm": None}],
            }),
            self.assertRaises(HTTPException) as failure,
        ):
            weather.irrigation_forecast("31.52,74.36")
        self.assertEqual(failure.exception.status_code, 502)
        self.assertIn("reference ET", failure.exception.detail)

    def test_forecast_uses_live_openweather_and_falls_back_if_invalid(self):
        now = datetime.now(UTC)
        primary = {"daily": [], "interval_hours": 3, "hourly": [{"time": (now + timedelta(hours=2)).isoformat()}]}
        fallback = {
            "daily": [{"date": now.astimezone(weather.LOCAL_ZONE).date().isoformat(), "rain_mm": 0, "eto_mm": 3}],
            "hourly": [{"time": now.isoformat()}],
        }
        with (
            patch.object(openweather, "forecast", side_effect=[primary, ProviderError("OpenWeather /forecast: HTTP 503", 503)]),
            patch.object(weather.backup, "forecast", return_value=fallback) as load,
        ):
            first = weather.forecast("30.15,71.52")
            second = weather.forecast("31.52,74.36")
        self.assertEqual(first["source"], "OpenWeather")
        self.assertEqual(second["source"], "Open-Meteo")
        self.assertIn("HTTP 503", second["fallback_reason"])
        load.assert_called_once_with(31.52, 74.36, None)

    def test_archive_converts_daily_solar_energy_and_omits_missing(self):
        data = {
            "header": {"time_standard": "UTC"},
            "parameters": {"ALLSKY_SFC_SW_DWN": {"units": "kW-hr/m^2/day"}},
            "properties": {"parameter": {
                "ALLSKY_SFC_SW_DWN": {"20261001": 4.8},
                "PRECTOTCORR": {"20261001": 0},
                "T2M_MIN": {"20261001": -999},
            }},
        }
        day = date(2026, 10, 1)
        with patch.object(weather.backup, "fetch", return_value=data) as fetch:
            result = weather.history(31.52, 74.36, day, day)
        self.assertEqual(fetch.call_args.args[1]["time-standard"], "UTC")
        self.assertEqual(result["source"], "NASA POWER")
        self.assertEqual(result["daily"][0]["solar_w_m2"], 200)
        self.assertEqual(result["daily"][0]["precipitation_mm"], 0)
        self.assertIsNone(result["daily"][0]["min_c"])

    def test_soil_and_solar_preserve_model_depths(self):
        readings = {
            "time": ["2026-11-24T05:00"],
            "soil_moisture_0_to_1cm": [0.29],
            "soil_temperature_0cm": [18],
            "shortwave_radiation": [0],
        }
        with patch.object(weather.backup, "open_meteo", return_value={"hourly": readings}):
            result = weather.agriculture(31.52, 74.36)
        self.assertEqual(result["source"], "Open-Meteo")
        self.assertEqual(result["hourly"][0]["soil_moisture_0_1_pct"], 29)
        self.assertEqual(result["hourly"][0]["solar_w_m2"], 0)

    def test_fresh_cache_expires_and_dual_failure_drops_previous_values(self):
        now = datetime.now(UTC).isoformat()
        with (
            patch.object(weather, "monotonic") as clock,
            patch.object(openweather, "current", side_effect=[
                {"temperature_c": 18, "time": now}, {"temperature_c": 19, "time": now},
                ProviderError("OpenWeather /weather: HTTP 503", 503),
            ]) as primary,
            patch.object(weather.backup, "current", side_effect=httpx.ConnectError("offline")) as fallback,
        ):
            clock.return_value = 10
            first = weather.current("31.52,74.36")
            self.assertEqual(weather.current("31.52,74.36")["temperature_c"], 18)
            clock.return_value = 210
            second = weather.current("31.52,74.36")
            clock.return_value = 410
            with self.assertRaises(HTTPException) as failure:
                weather.current("31.52,74.36")
        self.assertEqual(first["temperature_c"], 18)
        self.assertEqual(second["temperature_c"], 19)
        self.assertEqual(second["source"], "OpenWeather")
        self.assertIn("retrieved_at", second)
        self.assertEqual(primary.call_count, 3)
        fallback.assert_called_once_with(31.52, 74.36)
        self.assertEqual(failure.exception.status_code, 502)
        self.assertIn("both weather providers", failure.exception.detail)

    def test_stale_primary_reading_uses_fresh_fallback(self):
        stale = (datetime.now(UTC) - timedelta(hours=4)).isoformat()
        fresh = datetime.now(UTC).isoformat()
        with (
            patch.object(openweather, "current", return_value={"temperature_c": 19, "time": stale}),
            patch.object(weather.backup, "current", return_value={"temperature_c": 18, "time": fresh}),
        ):
            data = weather.current("30.1575,71.5249")
        self.assertEqual(data["source"], "Open-Meteo")
        self.assertIn("stale", data["fallback_reason"])
