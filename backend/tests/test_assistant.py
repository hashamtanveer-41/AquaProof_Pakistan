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
    waha,
)
from app.officer_auth import authorized, password_hash, signature, trusted_write
from app.science.crops import local_today
from app.science.irrigation import IrrigationSettings


class AssistantTest(TestCase):
    def test_officer_sessions_reject_expired_and_tampered_cookies(self):
        verifier, secret = password_hash("synthetic password"), "s" * 40
        with patch.dict("os.environ", {
            "AQUAPROOF_OFFICER_PASSWORD_HASH": verifier, "AQUAPROOF_SESSION_SECRET": secret,
        }), patch("app.officer_auth.time.time", return_value=100):
            active = "101." + "a" * 24
            old = "99." + "a" * 24
            proof = signature(active, verifier, secret)
            self.assertTrue(authorized(f"{active}.{proof}"))
            self.assertFalse(authorized(f"{old}.{signature(old, verifier, secret)}"))
            self.assertFalse(authorized(f"102.{active.split('.')[1]}.{proof}"))
            self.assertFalse(authorized(None))

    def test_trusted_write_accepts_same_host_and_configured_origins(self):
        def request(origin, host="api.onrender.com", scheme="https"):
            return Mock(method="POST", headers={"Origin": origin},
                        url=Mock(netloc=host, scheme=scheme))

        with patch.dict("os.environ", {"AQUAPROOF_SECURE_COOKIES": "1",
                                       "CORS_ORIGINS": "https://app.vercel.app"}):
            # The backend's own origin is always trusted.
            self.assertTrue(trusted_write(request("https://api.onrender.com")))
            # The configured front-end origin (Vercel proxying /api) is trusted.
            self.assertTrue(trusted_write(request("https://app.vercel.app")))
            # An unlisted cross-origin write is rejected.
            self.assertFalse(trusted_write(request("https://evil.example")))
        with patch.dict("os.environ", {"AQUAPROOF_SECURE_COOKIES": "1", "CORS_ORIGINS": ""}):
            # With no allowlist, only same-host writes pass (original behaviour).
            self.assertFalse(trusted_write(request("https://app.vercel.app")))

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

    def test_groq_completion_retries_and_sends_no_provider_block(self):
        success = httpx.Response(200, json={
            "choices": [{"finish_reason": "stop", "message": {"content": "{}"}}],
            "usage": {"prompt_tokens": 15, "completion_tokens": 2, "cost": 0.1},
        })
        with (
            patch.object(assistant_model, "config", return_value=("key", "openai/gpt-oss-120b")),
            patch.object(assistant_model, "reserve_call") as budget,
            patch.object(assistant_model.httpx, "post", side_effect=[httpx.Response(429), success]) as send,
            patch.object(assistant_model.time, "sleep"),
        ):
            usage = []
            assistant_model.request_model("farmer", [], usage)
        body = send.call_args.kwargs["json"]
        # Groq's OpenAI-compatible endpoint rejects OpenRouter's provider routing object.
        self.assertNotIn("provider", body)
        self.assertEqual(body["model"], "openai/gpt-oss-120b")
        self.assertEqual(send.call_args.args[0], assistant_model.ENDPOINT)
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
        self.assertIn("khet", assistant_copy.template("roman_ur", "clarify").casefold())

    def test_identity_and_greeting_answers_come_from_the_model(self):
        aliases = {"F1": {"id": "parcel", "name": "North field"}}
        facts = {"assistant": assistant_jobs.ASSISTANT_IDENTITY, "field_name": "North field"}
        # A question on a known field (even one the model tags 'clarify') routes through the field's
        # full live context so the model can answer any follow-up; the reply is always composed.
        with (
            patch.object(assistant_jobs.model, "decide", return_value=assistant_model.Decision(
                language="en", intent="clarify", farm="F1", tip="none")),
            patch.object(assistant_jobs, "full_context", return_value=(facts, {})) as context,
            patch.object(assistant_jobs.model, "compose_answer",
                         return_value="I am the AquaProof AI assistant.") as compose,
        ):
            reply = assistant_jobs.compute(
                {"farmer_id": "owner", "kind": "inbound"},
                ({"language": "en"}, aliases, "F1", "Who are you?", []),
            )
        self.assertEqual(reply[0], "parcel")
        self.assertEqual(reply[2], "I am the AquaProof AI assistant.")
        context.assert_called_once()
        sent = compose.call_args.args[1]
        self.assertIn("AquaProof", sent["assistant"])
        self.assertEqual(sent["known_fields"], ["North field"])

    def test_known_field_question_answers_with_data_not_ask_officer(self):
        aliases = {"F1": {"id": "parcel", "name": "North field"}}
        facts = {"assistant": assistant_jobs.ASSISTANT_IDENTITY, "field_name": "North field",
                 "land": {"area_acres": 2.5}}
        # A vague "farm stats" question must never fall back to the officer: a linked field always
        # answers from its full context.
        with (
            patch.object(assistant_jobs.model, "decide", return_value=assistant_model.Decision(
                language="en", intent="clarify", farm="F1", tip="none")),
            patch.object(assistant_jobs, "full_context", return_value=(facts, {})) as context,
            patch.object(assistant_jobs.model, "compose_answer",
                         side_effect=lambda fid, f, lang, q, usage: f"Area {f['land']['area_acres']} acres"),
        ):
            reply = assistant_jobs.compute(
                {"farmer_id": "owner", "kind": "inbound"},
                ({"language": "en"}, aliases, "F1", "tell me my farm stats", []),
            )
        context.assert_called_once()
        self.assertEqual(reply[2], "Area 2.5 acres")

    def test_unavailable_model_retries_instead_of_a_stored_reply(self):
        aliases = {"F1": {"id": "parcel", "name": "North field"}}
        facts = {"assistant": assistant_jobs.ASSISTANT_IDENTITY, "field_name": "North field"}
        # With no model there is no canned fallback: the worker raises so the job retries.
        with (
            patch.object(assistant_model, "config", return_value=None),
            patch.object(assistant_jobs, "full_context", return_value=(facts, {})),
        ):
            with self.assertRaises(assistant_model.ModelUnavailable):
                assistant_jobs.compute(
                    {"farmer_id": "owner", "kind": "inbound"},
                    ({"language": "en"}, aliases, "F1", "Who are you?", []),
                )

    def test_waha_direct_and_linked_quoted_message(self):
        adapter = waha.WAHA("https://waha.example", "default", "qa-only", "secret")
        payload = {
            "id": "false_923000000001@c.us_qa-message", "from": "923000000001@c.us",
            "fromMe": False, "body": "Pani?", "replyTo": {"body": "signed quote", "id": "true_12345@lid_original"},
        }
        event = {"session": "default", "event": "message", "payload": payload}
        self.assertEqual(adapter.incoming_text(event),
                         ("923000000001", "qa-message", "Pani?", "signed quote", "original"))
        for disallowed in ({"from": "group@g.us"}, {"fromMe": True}, {"hasMedia": True},
                           {"from": "status@broadcast"}, {"from": "123@newsletter"}):
            self.assertIsNone(adapter.incoming_text({**event, "payload": {**payload, **disallowed}}))
        self.assertIsNone(adapter.incoming_text({**event, "session": "other"}))
        linked = {**event, "payload": {**payload, "from": "12345@lid"}}
        with patch.object(waha.httpx, "request", return_value=httpx.Response(
            200, json={"lid": "12345@lid", "pn": "923000000001@c.us"},
        )) as request:
            self.assertEqual(adapter.incoming_text(linked)[0], "923000000001")
            self.assertTrue(request.call_args.args[1].endswith("/api/default/lids/12345%40lid"))
        with patch.object(waha.httpx, "request", return_value=httpx.Response(
            200, json={"lid": "54321@lid", "pn": "923000000001@c.us"},
        )):
            self.assertIsNone(adapter.incoming_text(linked))
        gows = {**linked["payload"], "_data": {"Info": {
            "Chat": "12345@lid", "Sender": "12345@lid", "SenderAlt": "923000000001@s.whatsapp.net",
        }}}
        self.assertEqual(adapter.incoming_text({**linked, "payload": gows})[0], "923000000001")

    def test_waha_outbound_schema_and_unknown_delivery(self):
        adapter = waha.WAHA("https://waha.example", "default", "qa-only", "secret")
        with patch.object(waha.httpx, "request", return_value=httpx.Response(
            201, json={"id": "true_923000000001@c.us_out-1"},
        )) as request:
            self.assertEqual(adapter.send("923000000001", "Farm question"), "out-1")
            self.assertEqual(request.call_args.args, ("POST", "https://waha.example/api/sendText"))
            self.assertEqual(request.call_args.kwargs["headers"]["X-Api-Key"], "qa-only")
            self.assertEqual(request.call_args.kwargs["json"], {
                "chatId": "923000000001@c.us", "text": "Farm question", "session": "default", "linkPreview": False,
            })
        with patch.object(waha.httpx, "request", side_effect=httpx.ReadTimeout("private URL")):
            with self.assertRaisesRegex(waha.ProviderError, "sendText timed out") as error:
                adapter.send("923000000001", "Farm question")
            self.assertNotIn("private URL", str(error.exception))
