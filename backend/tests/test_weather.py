from datetime import date
from unittest import TestCase
from unittest.mock import patch

import httpx
from fastapi import HTTPException

from app.science import weather


class TomorrowWeatherTest(TestCase):
    def test_forecast_accepts_variable_horizon_and_converts_units(self):
        first = {
            "time": "2026-11-23T23:00:00Z",
            "values": {
                "temperatureMin": 13,
                "rainAccumulationSum": 0,
                "evapotranspirationSum": 2.5,
                "windSpeedMax": 5,
                "windGustMax": 8,
            },
        }
        result = weather.forecast_payload({
            "location": {"lat": 31.52, "lon": 74.36},
            "timelines": {
                "daily": [first, {**first, "time": "2026-11-24T23:00:00Z", "values": {}}],
                "hourly": [{"time": "2026-11-24T03:00:00Z", "values": {"windSpeed": 2}}],
            },
        })
        self.assertEqual([row["date"] for row in result["daily"]], ["2026-11-24", "2026-11-25"])
        self.assertEqual(result["daily"][0]["rain_mm"], 0)
        self.assertEqual(result["daily"][0]["eto_mm"], 2.5)
        self.assertEqual(result["daily"][0]["wind_kmh"], 18)
        self.assertEqual(result["daily"][0]["gust_kmh"], 28.8)
        self.assertIsNone(result["daily"][1]["rain_mm"])
        self.assertEqual(result["hourly"][0]["wind_kmh"], 7.2)

    def test_provider_key_stays_in_header_and_rate_limit_is_sanitized(self):
        with (
            patch.dict("os.environ", {"TOMORROW_API_KEY": "local-test-key"}),
            patch.object(httpx, "request", return_value=httpx.Response(429)) as mock_request,
        ):
            with self.assertRaises(HTTPException) as failure:
                weather.provider_json("weather/forecast", params={"location": "Lahore"}, feature="forecast")
        self.assertEqual(failure.exception.status_code, 503)
        self.assertIn("request limit", failure.exception.detail)
        self.assertNotIn("local-test-key", failure.exception.detail)
        self.assertEqual(mock_request.call_args.kwargs["headers"]["apikey"], "local-test-key")
        self.assertEqual(mock_request.call_args.kwargs["params"], {"location": "Lahore"})

    def test_archive_uses_daily_precipitation_totals_and_bounds_dates(self):
        intervals = [
            {
                "startTime": "2026-11-01T00:00:00Z",
                "values": {"temperatureMax": 23, "precipitationAccumulationSum": 4.5, "solarGHIAvg": 120},
            },
            {"startTime": "2026-11-02T00:00:00Z", "values": {}},
        ]
        day = date(2026, 11, 1)
        with patch.object(weather, "provider_json", return_value={
            "data": {"timelines": [{"timestep": "1d", "intervals": intervals}]},
        }) as mock_request:
            rows = weather.history(31.52, 74.36, day, day)["daily"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["precipitation_mm"], 4.5)
        self.assertEqual(rows[0]["solar_w_m2"], 120)
        body = mock_request.call_args.kwargs["body"]
        self.assertEqual(body["location"], [31.52, 74.36])
        self.assertEqual(body["timezone"], "UTC")
        self.assertIn("precipitationAccumulationSum", body["fields"])

    def test_soil_and_solar_keep_missing_values_and_report_plan_denial(self):
        result = {"data": {"timelines": [{"timestep": "1h", "intervals": [
            {"startTime": "2026-11-24T05:00:00Z", "values": {"soilMoistureVolumetric0To10": 27}},
            {"startTime": "2026-11-24T06:00:00Z", "values": {}},
        ]}]}}
        with patch.object(weather, "provider_json", return_value=result):
            rows = weather.tomorrow_agriculture(31.52, 74.36)["hourly"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["soil_moisture_surface_pct"], 27)
        self.assertIsNone(rows[0]["solar_w_m2"])

        with (
            patch.dict("os.environ", {"TOMORROW_API_KEY": "local-test-key"}),
            patch.object(httpx, "request", return_value=httpx.Response(403)),
        ):
            with self.assertRaises(HTTPException) as failure:
                weather.provider_json("historical", body={}, feature="archive history", access_limited=True)
        self.assertEqual(failure.exception.status_code, 403)
        self.assertIn("Check your API plan", failure.exception.detail)

    def test_denied_soil_and_solar_uses_backup_with_its_actual_depths(self):
        readings = {
            "time": ["2026-11-24T05:00"],
            "soil_moisture_0_to_1cm": [0.29],
            "soil_temperature_0cm": [18],
            "shortwave_radiation": [0],
        }
        with (
            patch.object(weather, "provider_json", side_effect=HTTPException(403)),
            patch.object(weather.backup, "open_meteo", return_value={"hourly": readings}),
        ):
            result = weather.agriculture(31.52, 74.36)
        self.assertEqual(result["source"], "Open-Meteo")
        self.assertEqual(result["soil_profile"], "open-meteo")
        self.assertEqual(result["hourly"][0]["soil_moisture_0_1_pct"], 29)
        self.assertEqual(result["hourly"][0]["solar_w_m2"], 0)
        self.assertNotIn("soil_moisture_surface_pct", result["hourly"][0])

    def test_forecast_falls_back_for_missing_et_and_named_location(self):
        incomplete = {"daily": [{"date": "2026-11-24", "rain_mm": 0, "eto_mm": None}]}
        complete = {"daily": [{"date": "2026-11-24", "rain_mm": 0, "eto_mm": 2.2}]}
        places = [
            {"name": "Lahore", "latitude": 34, "longitude": 75, "country": "Other"},
            {"name": "Lahore", "latitude": 31.52, "longitude": 74.36, "country": "Pakistan"},
        ]
        with (
            patch.object(weather, "tomorrow_forecast", return_value=incomplete),
            patch.object(weather, "geocode", return_value=places),
            patch.object(weather.backup, "forecast", return_value=complete) as fetch,
        ):
            result = weather.forecast("Lahore, Pakistan")
        fetch.assert_called_once_with(31.52, 74.36, "Lahore, Pakistan")
        self.assertEqual(result["source"], "Open-Meteo")
        self.assertEqual(result["daily"][0]["eto_mm"], 2.2)

    def test_archive_fallback_converts_daily_solar_energy_and_omits_missing(self):
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
        with (
            patch.object(weather, "provider_json", side_effect=HTTPException(403)),
            patch.object(weather.backup, "fetch", return_value=data) as fetch,
        ):
            result = weather.history(31.52, 74.36, day, day)
        self.assertEqual(fetch.call_args.args[1]["time-standard"], "UTC")
        self.assertEqual(result["source"], "NASA POWER")
        self.assertEqual(result["daily"][0]["solar_w_m2"], 200)
        self.assertEqual(result["daily"][0]["precipitation_mm"], 0)
        self.assertIsNone(result["daily"][0]["min_c"])

    def test_each_request_fetches_again_and_dual_failure_drops_previous_values(self):
        with (
            patch.object(weather, "tomorrow_current", side_effect=[
                {"temperature_c": 18}, {"temperature_c": 19}, HTTPException(503),
            ]) as primary,
            patch.object(weather.backup, "current", side_effect=httpx.ConnectError("offline")) as fallback,
        ):
            first = weather.current("31.52,74.36")
            second = weather.current("31.52,74.36")
            with self.assertRaises(HTTPException) as failure:
                weather.current("31.52,74.36")
        self.assertEqual(first["temperature_c"], 18)
        self.assertEqual(second["temperature_c"], 19)
        self.assertEqual(second["source"], "Tomorrow.io")
        self.assertIn("retrieved_at", second)
        self.assertEqual(primary.call_count, 3)
        fallback.assert_called_once_with(31.52, 74.36)
        self.assertEqual(failure.exception.status_code, 502)
        self.assertIn("both weather providers", failure.exception.detail)
