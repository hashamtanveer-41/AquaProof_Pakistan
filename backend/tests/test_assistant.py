from datetime import UTC, datetime, timedelta
from unittest import TestCase
from unittest.mock import Mock, patch

import httpx
from fastapi import HTTPException
from pydantic import ValidationError

from app import (
    assistant_copy,
    assistant_farms,
    assistant_jobs,
    assistant_model,
    green_api,
)
from app.assistant_access import officer_authorized
from app.science.crops import local_today
from app.science.irrigation import IrrigationSettings


class AssistantTest(TestCase):
    def test_officer_gate_requires_a_configured_secret(self):
        with patch.dict("os.environ", {"ASSISTANT_OFFICER_TOKEN": "a" * 40}):
            self.assertTrue(officer_authorized("Bearer " + "a" * 40))
            self.assertFalse(officer_authorized("Bearer " + "b" * 40))
            self.assertFalse(officer_authorized(None))

    def test_unauthorized_tool_arguments_never_query_the_database(self):
        ctx = assistant_model.ToolContext("owner", {"F1": {"id": "own-field"}}, "inbound")
        with patch.object(assistant_farms, "farm_profile") as read:
            self.assertIn("error", ctx.execute("get_farm_profile", {"farm": "other-field"}))
            self.assertIn("error", ctx.execute("get_farm_profile", {"farm": "F1", "farmer": "other"}))
            self.assertIn("error", ctx.execute("execute_sql", {"query": "anything"}))
            read.assert_not_called()

    def test_invalid_reply_token_never_opens_database(self):
        with patch.dict("os.environ", {"ASSISTANT_REPLY_SECRET": "r" * 40}), patch.object(assistant_jobs, "connect") as db:
            self.assertFalse(assistant_jobs.accept_message("farmer@example.com", "x", "From: farmer@example.com"))
            self.assertFalse(assistant_jobs.accept_message(
                "farmer@example.com", "x", "AQ-REPLY 00000000-0000-0000-0000-000000000000." + "a" * 64,
            ))
            db.assert_not_called()

    def test_stale_measurements_and_gross_pump_volume(self):
        self.assertFalse(assistant_farms.fresh(
            {"time": datetime.now(UTC) - timedelta(hours=37)}, "time", timedelta(hours=36),
        ))
        self.assertTrue(assistant_farms.fresh(
            {"time": datetime.now(UTC).isoformat()}, "time", timedelta(minutes=10),
        ))
        settings = IrrigationSettings.model_validate({
            "taw_mm": 100, "initial_depletion_mm": 20, "allowable_depletion": .5, "efficiency": .5,
            "surface_taw_mm": 20, "surface_raw_mm": 8, "initial_surface_depletion_mm": 8,
            "tubewell": {"flow_m3_hour": 60, "hours_per_day": 8, "pkr_hour": 150},
        })
        # The volume passed here is already gross and must not be divided by efficiency a second time.
        self.assertEqual(assistant_farms.pump_metrics(120, settings), {"hours": 2, "pkr": 300})

    def test_provider_failure_is_retained_and_older_evidence_expires(self):
        field = {"latitude": 30, "longitude": 71}
        now = datetime.now(UTC)
        current = {"time": now.isoformat(), "retrieved_at": now.isoformat()}
        with (
            patch.object(assistant_farms, "current_weather", return_value=current),
            patch.object(assistant_farms, "field_weather_forecast",
                         side_effect=HTTPException(502, "OpenWeather and Open-Meteo failed")),
            patch.object(assistant_farms, "fresh_forecast", return_value=current),
            patch.object(assistant_farms.weather, "agriculture",
                         return_value={"source": "Open-Meteo", "retrieved_at": now.isoformat()}),
        ):
            evidence = assistant_farms.live_conditions(field)
        self.assertIsNone(evidence["weather_forecast"])
        self.assertIn("OpenWeather", evidence["weather_errors"]["weather_forecast"])
        self.assertTrue(assistant_farms.delivery_evidence_is_current(evidence))
        evidence["forecast"] = {**current, "retrieved_at": (now - timedelta(minutes=11)).isoformat()}
        self.assertFalse(assistant_farms.delivery_evidence_is_current(evidence))

    def test_observation_requires_source_and_duration(self):
        with self.assertRaises(ValidationError):
            assistant_model.Observation.model_validate({
                "day": local_today().isoformat(), "source": "canal", "irrigation_minutes": None,
                "rainfall_mm": None, "soil": None,
            })

    def test_openrouter_retries_and_restricts_all_provider_choices(self):
        success = httpx.Response(200, json={
            "choices": [{"finish_reason": "stop", "message": {"content": "{}"}}],
            "usage": {"prompt_tokens": 15, "completion_tokens": 2, "cost": 0.1},
        })
        with (
            patch.object(assistant_model, "config", return_value=("key", "model", ["approved-a", "approved-b"])),
            patch.object(assistant_model, "reserve_call") as budget,
            patch.object(assistant_model.httpx, "post", side_effect=[httpx.Response(429), success]) as send,
            patch.object(assistant_model.time, "sleep"),
        ):
            usage = []
            assistant_model.request_model("farmer", [], usage)
        route = send.call_args.kwargs["json"]["provider"]
        self.assertEqual(route["only"], ["approved-a", "approved-b"])
        self.assertTrue(route["zdr"])
        self.assertTrue(route["require_parameters"])
        self.assertEqual(route["data_collection"], "deny")
        self.assertEqual(budget.call_count, 2)
        self.assertEqual(usage[0]["cost"], 0.1)

    def test_malformed_model_output_uses_language_template(self):
        ctx = assistant_model.ToolContext("owner", {}, "inbound")
        incompatible = Mock(return_value={"content": '{"language":"ur","message":"invent water"}'})
        with patch.object(assistant_model, "request_model", incompatible):
            result = assistant_model.decide(ctx, "کتنا پانی؟", [], None, "ur", [])
        self.assertEqual(result.intent, "clarify")
        self.assertEqual(result.language, "ur")
        self.assertIn("کھیت", assistant_copy.template(result.language, "clarify"))
        self.assertIn("Khet", assistant_copy.template("roman_ur", "clarify"))

    def test_green_api_quoted_message_and_acknowledgement(self):
        adapter = green_api.GreenAPI("https://api.green-api.com", "1234567890", "qa-only")
        direct = {"chatId": "923000000001@c.us", "sender": "923000000001@c.us"}
        message = {
            "typeWebhook": "incomingMessageReceived", "instanceData": {"idInstance": 1234567890},
            "idMessage": "qa-message", "senderData": direct,
            "messageData": {"typeMessage": "quotedMessage", "extendedTextMessageData": {"text": "Pani?"},
                            "quotedMessage": {"textMessage": "signed quote", "stanzaId": "original"}},
        }
        group = {**message, "senderData": {**direct, "chatId": "group@g.us"}}
        def response(receipt, body):
            return httpx.Response(200, json={"receiptId": receipt, "body": body})

        consume = Mock()
        with patch.object(green_api.httpx, "request", side_effect=[
            response(10, group), httpx.Response(200, json={"result": True}),
            response(11, message), httpx.Response(200, json={"result": True}),
            httpx.Response(200, content=b"null"),
        ]) as request:
            adapter.receive(consume)
            self.assertEqual([call.args[0] for call in request.call_args_list],
                             ["GET", "DELETE", "GET", "DELETE", "GET"])
        consume.assert_called_once_with("923000000001", "qa-message", "Pani?", "signed quote", "original")
        id_only = {**message, "messageData": {
            "typeMessage": "quotedMessage", "extendedTextMessageData": {"text": "بارش؟", "stanzaId": "original"},
        }}
        self.assertEqual(green_api.incoming_text(id_only, "1234567890"),
                         ("923000000001", "qa-message", "بارش؟", None, "original"))
        with patch.object(green_api.httpx, "request", return_value=response(11, message)) as request:
            with self.assertRaises(RuntimeError):
                adapter.receive(Mock(side_effect=RuntimeError))
            request.assert_called_once()

    def test_green_api_outbound_schema_and_unknown_delivery(self):
        adapter = green_api.GreenAPI("https://api.green-api.com", "1234567890", "qa-only")
        with patch.object(green_api.httpx, "request", return_value=httpx.Response(200, json={"idMessage": "out-1"})) as request:
            self.assertEqual(adapter.send("923000000001", "Farm question"), "out-1")
            self.assertEqual(request.call_args.kwargs["json"], {"chatId": "923000000001@c.us", "message": "Farm question"})
        with patch.object(green_api.httpx, "request", side_effect=httpx.ReadTimeout("private URL")):
            with self.assertRaisesRegex(green_api.ProviderError, "sendMessage timed out") as error:
                adapter.send("923000000001", "Farm question")
            self.assertNotIn("private URL", str(error.exception))
