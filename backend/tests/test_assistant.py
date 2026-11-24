from datetime import UTC, datetime, timedelta
from unittest import TestCase
from unittest.mock import MagicMock, Mock, patch

import httpx
from pydantic import ValidationError

from app import assistant_copy, assistant_farms, assistant_jobs, assistant_mail, assistant_model
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

    def test_imap_adapter_passes_plain_text_to_the_verified_ingress(self):
        raw = (
            b"From: Farmer <farmer@example.com>\r\nMessage-ID: <inbound@example.com>\r\n"
            b"Content-Type: text/plain; charset=utf-8\r\n\r\nPani ki report\r\n"
        )
        mailbox = MagicMock()
        mailbox.select.return_value = ("OK", [])
        mailbox.uid.side_effect = [("OK", [b"11"]), ("OK", [(b"11", raw)]), ("OK", [])]
        consume = Mock()
        with (
            patch.dict("os.environ", {"IMAP_HOST": "test", "IMAP_USERNAME": "test", "IMAP_PASSWORD": "test"}),
            patch.object(assistant_mail.imaplib, "IMAP4_SSL") as connect,
        ):
            connect.return_value.__enter__.return_value = mailbox
            assistant_mail.EmailTransport().receive(consume)
        recipient, message_id, text = consume.call_args.args
        self.assertEqual(recipient, "farmer@example.com")
        self.assertEqual(message_id, "<inbound@example.com>")
        self.assertEqual(text.strip(), "Pani ki report")
        self.assertEqual(mailbox.uid.call_args.args[:3], ("store", b"11", "+FLAGS"))
