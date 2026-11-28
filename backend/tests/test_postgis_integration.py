import hmac
import json
import os
from datetime import UTC, datetime
from unittest import TestCase, skipUnless
from unittest.mock import patch
from urllib.parse import urlsplit
from uuid import uuid4

from fastapi import HTTPException
from fastapi.testclient import TestClient

from app import officer_auth, waha
from app.assistant_access import farmer_scope
from app.assistant_farms import farm_profile
from app.assistant_jobs import (
    accept_message,
    process_one,
    queue_message,
    schedule,
    signed_token,
)
from app.assistant_model import Decision
from app.assistant_whatsapp import deliver
from app.database import connect, migrate
from app.main import app
from app.science import weather
from app.science.weather import LOCAL_ZONE

DATABASE = os.getenv("AQUAPROOF_TEST_DATABASE_URL", "")


@skipUnless(DATABASE, "Requires a disposable PostGIS database in AQUAPROOF_TEST_DATABASE_URL")
class PostgisTests(TestCase):
    def setUp(self):
        self.assertTrue(urlsplit(DATABASE).path.startswith("/aquaproof_test"), "Use a dedicated QA database")
        password = "synthetic PostGIS test"
        env = patch.dict(os.environ, {"DATABASE_URL": DATABASE,
                                      "AQUAPROOF_OFFICER_PASSWORD_HASH": officer_auth.password_hash(password),
                                      "AQUAPROOF_SESSION_SECRET": uuid4().hex,
                                      "ASSISTANT_ENABLED": "1", "AQUAPROOF_BACKGROUND_WHATSAPP": "0"})
        env.start()
        self.addCleanup(env.stop)
        self.client = TestClient(app)
        self.assertEqual(self.client.post("/api/auth/sign-in", json={"password": password}).status_code, 200)
        migrate()

    def register(self, name, longitude):
        suffix = uuid4().hex
        region = "Punjab" if name == "Test A" else "Sindh"
        ring = [[longitude, 30], [longitude + .001, 30], [longitude + .001, 30.001], [longitude, 30]]
        response = self.client.post("/api/registrations", json={
            "farmer": {"name": name, "email": f"qa-{suffix}@example.com", "phone": f"030{int(suffix[:10], 16) % 100000000:08}",
                       "region": region, "district": "QA district", "tehsil": "QA tehsil", "village": "QA village"},
            "field": {"name": f"{name} parcel", "soil": "Loam", "source": "Rain-fed", "crop": "Wheat",
                      "boundary": {"type": "Polygon", "coordinates": [ring]}},
        })
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def test_migrations_boundary_lifecycle_and_archive(self):
        migrate()
        with connect() as conn:
            self.assertTrue(conn.execute("SELECT PostGIS_Version() AS version").fetchone()["version"])
            self.assertEqual(conn.execute("SELECT COUNT(*) AS count FROM schema_migrations").fetchone()["count"], 13)
        response = self.register("Test A", 71.5)
        field = response["field"]
        self.assertGreater(field["acres"], 0)
        self.assertEqual(response["farmer"]["district"], "QA district")
        endpoint = "/api/fields/" + field["id"]
        boundary = {"type": "Polygon", "coordinates": [[[71.5, 30], [71.502, 30], [71.501, 30.001], [71.5, 30]]]}
        self.assertEqual(self.client.patch(endpoint, json=boundary).status_code, 200)
        saved = self.client.get(endpoint).json()
        self.assertEqual(saved["boundary"], boundary)
        self.assertGreater(saved["acres"], field["acres"])
        planted = datetime.now(LOCAL_ZONE).date().isoformat()
        self.assertEqual(self.client.post("/api/crop-seasons", params={"field_id": field["id"]},
                                         json={"crop": "Wheat", "planted": planted}).status_code, 201)
        crop = self.client.get(endpoint + "/crop-lifecycle").json()
        self.assertEqual(crop["current_stage"], "Initial")
        self.assertEqual(crop["regional_reference"]["label"], "Rabi wheat")
        self.assertEqual(self.client.delete(endpoint).status_code, 200)
        self.assertEqual(self.client.get(endpoint).status_code, 404)

    def test_permanent_deletion_removes_field_history_and_preserves_owner(self):
        saved = self.register("Delete QA", 72)
        farmer_id, field_id = saved["farmer"]["id"], saved["field"]["id"]
        sibling = self.client.post("/api/fields", params={"farmer_id": farmer_id}, json={
            "name": "Keep this field", "crop": "Wheat", "soil": "Loam", "source": "Rain-fed",
            "boundary": saved["field"]["boundary"],
        })
        self.assertEqual(sibling.status_code, 201, sibling.text)
        sibling_id = sibling.json()["id"]
        with connect() as conn:
            conn.execute("""INSERT INTO assistant_identities(farmer_id,whatsapp_phone,whatsapp_verified_at)
                            SELECT id,aquaproof_whatsapp_phone(phone),now() FROM farmers WHERE id=%s""", (farmer_id,))
            message = queue_message(conn, farmer_id, kind="manual", body="Delete this record",
                                    field_id=field_id, dedupe=f"delete:{field_id}")["id"]
            keep = queue_message(conn, farmer_id, kind="manual", body="Keep this record",
                                 field_id=sibling_id, dedupe=f"keep:{field_id}")["id"]
            conn.execute("""INSERT INTO assistant_jobs(farmer_id,field_id,kind,inbound_id,local_day,dedupe)
                            VALUES (%s,%s,'inbound',%s,current_date,%s)""",
                         (farmer_id, field_id, message, f"test-job:{field_id}"))
            conn.execute("""INSERT INTO assistant_observations(farmer_id,field_id,inbound_id,measurements)
                            VALUES (%s,%s,%s,'{}')""", (farmer_id, field_id, message))
            conn.execute("INSERT INTO irrigation_settings(field_id,settings) VALUES (%s,'{}')", (field_id,))
            conn.execute("""INSERT INTO irrigation_decisions(season_id,irrigation_date,revision,action,
                            canal_m3,pump_m3,weather_source,weather_retrieved_at)
                            SELECT id,current_date,1,'skip',0,0,'QA',now() FROM crop_seasons WHERE field_id=%s""",
                         (field_id,))
            advisory = conn.execute("""INSERT INTO advisories(field_id,subject,body) VALUES (%s,'QA','QA')
                                       RETURNING id""", (field_id,)).fetchone()["id"]
            conn.execute("""INSERT INTO farmer_messages(advisory_id,message_id,body,status)
                            VALUES (%s,%s,'QA','review')""", (advisory, f"legacy:{field_id}"))
        point = (round(saved["field"]["latitude"], 5), round(saved["field"]["longitude"], 5))
        cache_key = ("current", weather.point_query(*point))
        self.assertEqual(weather.cached(cache_key, lambda: "before"), "before")
        self.assertEqual(self.client.delete(f"/api/fields/{field_id}").status_code, 200)
        archived_url = "/api/registry/archived-fields"
        self.assertIn(field_id, [row["id"] for row in self.client.get(archived_url).json()])
        endpoint = "/api/registry/permanent-field-deletion"
        payload = {"field_id": field_id, "confirmation": "DELETE"}
        self.assertEqual(TestClient(app).post(endpoint, json=payload).status_code, 401)
        self.assertEqual(self.client.post(endpoint, json={**payload, "confirmation": "cancel"}).status_code, 422)
        self.assertEqual(self.client.post(endpoint, json=payload).status_code, 204)
        self.assertEqual(self.client.post(endpoint, json=payload).status_code, 204)
        self.assertNotIn(field_id, [row["id"] for row in self.client.get(archived_url).json()])
        self.assertEqual(weather.cached(cache_key, lambda: "after"), "after")
        with connect() as conn:
            self.assertIsNone(conn.execute("SELECT id FROM fields WHERE id=%s", (field_id,)).fetchone())
            self.assertIsNone(conn.execute("SELECT id FROM assistant_audit WHERE message_id=%s", (message,)).fetchone())
            self.assertIsNone(conn.execute("SELECT id FROM farmer_messages WHERE advisory_id=%s", (advisory,)).fetchone())
            self.assertEqual(conn.execute("SELECT id FROM assistant_messages WHERE farmer_id=%s",
                                          (farmer_id,)).fetchall(), [{"id": keep}])
        self.assertEqual(self.client.get(f"/api/fields/{sibling_id}").status_code, 200)
        self.assertEqual(self.client.get(f"/api/farmers/{farmer_id}").status_code, 200)

    def test_rls_and_scheduler_use_verified_owner(self):
        left, right = self.register("Test A", 71.5), self.register("Test B", 68.3)
        a, b = left["farmer"]["id"], right["farmer"]["id"]
        field_a, field_b = left["field"]["id"], right["field"]["id"]
        with connect() as conn:
            conn.execute("""INSERT INTO assistant_identities(farmer_id,whatsapp_phone,language,whatsapp_verified_at)
                         VALUES (%s,aquaproof_whatsapp_phone(%s),'en',now())""", (a, left["farmer"]["phone"]))
        with farmer_scope(a) as conn:
            self.assertEqual(conn.execute("SELECT id FROM fields").fetchall(), [{"id": field_a}])
            self.assertEqual(conn.execute("SELECT field_id FROM crop_seasons").fetchall(), [{"field_id": field_a}])
        with self.assertRaises(HTTPException):
            farm_profile(a, field_b)
        with self.assertRaises(HTTPException):
            farm_profile(b, field_b)
        now = datetime.now(LOCAL_ZONE).replace(hour=8)
        schedule(now)
        schedule(now)
        with connect() as conn:
            rows = conn.execute("SELECT field_id FROM assistant_jobs WHERE farmer_id IN (%s,%s) AND kind='daily'",
                                (a, b)).fetchall()
        self.assertEqual(rows, [{"field_id": field_a}])

    def test_enrollment_delivery_and_signed_reply(self):
        fixture = self.register("Test A", 71.5)
        other = self.register("Other Farmer", 72.5)
        farmer, field = fixture["farmer"], fixture["field"]
        phone = "92" + farmer["phone"][1:]
        webhook_secret = "wa-hook-" * 5

        def webhook(sender, message_id, text, *, quote=None, reply_to=None, timestamp=None, key=webhook_secret):
            body = json.dumps({
                "event": "message", "session": "default",
                "payload": {
                    "id": f"false_{sender}@c.us_{message_id}", "from": f"{sender}@c.us",
                    "fromMe": False, "body": text, "replyTo": {"id": reply_to, "body": quote},
                    "timestamp": timestamp,
                },
            }).encode()
            return TestClient(app).post("/webhooks/waha", content=body, headers={
                "X-Webhook-Hmac-Algorithm": "sha512",
                "X-Webhook-Hmac": hmac.new(key.encode(), body, "sha512").hexdigest(),
            })

        with (
            patch.dict(os.environ, {
                "ASSISTANT_REPLY_SECRET": "qa-only-" * 5, "AQUAPROOF_BACKGROUND_WHATSAPP": "1",
                "WAHA_BASE_URL": "http://127.0.0.1:3000", "WAHA_API_KEY": "qa-http",
                "WAHA_WEBHOOK_SECRET": webhook_secret, "WAHA_SESSION": "default",
            }),
            patch.object(waha.WAHA, "state", return_value=("WORKING", 200)),
            patch.object(waha.WAHA, "send") as sender,
        ):
            sender.side_effect = ["qa-outbound", "qa-welcome", "qa-answer", "qa-follow-up"]
            enrollment = self.client.post(f"/api/assistant/fields/{field['id']}/enroll", json={})
            self.assertEqual(enrollment.status_code, 202, enrollment.text)
            with connect() as conn:
                self.assertIsNone(queue_message(
                    conn, farmer["id"], kind="manual", body="Must not send before verification",
                    dedupe=f"unverified:{farmer['id']}", field_id=field["id"],
                ))
                self.assertIsNone(queue_message(
                    conn, other["farmer"]["id"], kind="manual", body="Unenrolled farmer",
                    dedupe=f"unenrolled:{other['farmer']['id']}", field_id=other["field"]["id"],
                ))
                conn.execute(
                    """INSERT INTO assistant_messages(id,farmer_id,field_id,direction,kind,status,body,dedupe,channel)
                       VALUES (%s,%s,%s,'outbound','manual','queued','Legacy email',%s,'email')""",
                    (uuid4(), farmer["id"], field["id"], f"legacy:{farmer['id']}"),
                )
            deliver()
            with connect() as conn:
                message = conn.execute(
                    """SELECT id,status,provider_message_id,whatsapp_transport
                       FROM assistant_messages WHERE farmer_id=%s AND kind='verify'""",
                    (farmer["id"],),
                ).fetchone()
            self.assertEqual((message["status"], message["provider_message_id"]), ("sent", "qa-outbound"))
            self.assertEqual(message["whatsapp_transport"], "waha")
            sender.assert_called_once()
            destination, body = sender.call_args.args
            self.assertEqual(destination, phone)
            self.assertIn("ہاں", body)
            token = "AQ-REPLY " + signed_token(message["id"])
            self.assertNotIn("AQ-REPLY", body)
            self.assertEqual(webhook(phone, "bad-signature", "YES", quote=token, key="other").status_code, 401)
            self.assertEqual(webhook("923999999999", "other", "YES", quote=token).status_code, 204)
            self.assertEqual(webhook("923999999999", "other-quote", "YES", reply_to="qa-outbound").status_code, 204)
            self.assertEqual(webhook(phone, "decline", "No", quote=body).status_code, 204)
            conversation_path = f"/api/assistant/conversations/{farmer['id']}"
            self.assertIsNone(self.client.get(conversation_path).json()["verified_at"])
            payload = {"id": "verification", "from": f"{phone}@c.us", "fromMe": False, "body": "ہاں",
                       "timestamp": datetime.now(UTC).timestamp()}
            older = {**payload, "id": "older-consent", "timestamp": payload["timestamp"] - 60}
            wrong_phone = {**payload, "id": "wrong-phone", "from": "923999999999@c.us"}
            with patch.object(waha.WAHA, "recent_inbound", return_value=[wrong_phone, payload, older]) as inbox:
                self.assertEqual(self.client.post(conversation_path + "/refresh").status_code, 200)
                self.assertEqual(inbox.call_args.args[0], phone)
            self.assertIsNotNone(self.client.get(conversation_path).json()["verified_at"])
            self.assertFalse(accept_message(phone, "replay", "YES", token))
            deliver()
            timestamp = datetime.now(UTC).timestamp()
            self.assertEqual(webhook(phone, "question", "میرے کھیت میں بارش ہوگی؟", timestamp=timestamp).status_code, 204)
            self.assertEqual(webhook(phone, "question", "میرے کھیت میں بارش ہوگی؟", timestamp=timestamp).status_code, 204)
            now = datetime.now(UTC).isoformat()
            forecast = {"source": "Mock OpenWeather", "retrieved_at": now, "daily": [
                {"rain_mm": 1.5, "precip_probability_pct": 60},
            ]}
            # Every farmer answer is composed by the model from the field facts (config=None only
            # drives the heuristic intent classifier; the composed reply is mocked deterministically).
            echo = lambda fid, facts, lang, q, usage: f"{facts.get('field_name', '')}: composed answer"
            with (
                patch("app.assistant_model.config", return_value=None),
                patch("app.assistant_model.compose_answer", side_effect=echo) as compose,
                patch("app.assistant_farms.current_weather", return_value={"time": now, "retrieved_at": now}) as current,
                patch("app.assistant_farms.field_weather_forecast", return_value=forecast) as weather,
                patch("app.assistant_farms.fresh_forecast", return_value=forecast) as irrigation,
                patch("app.assistant_farms.weather.agriculture",
                      return_value={"source": "Mock Open-Meteo", "retrieved_at": now}) as soil,
            ):
                process_one()
                for fetch in (current, weather, irrigation, soil):
                    fetch.assert_called_once()
                self.assertEqual(weather.call_args.args[0]["id"], field["id"])
                self.assertTrue(soil.call_args.kwargs["refresh"])
                self.assertTrue(compose.called)
            deliver()
            recipient, answer = sender.call_args.args
            self.assertEqual(recipient, phone)
            self.assertIn(field["name"], answer)
            self.assertNotIn(other["field"]["name"], answer)
            self.assertNotIn("AQ-REPLY", answer)
            self.assertEqual(webhook(phone, "follow-up", "مٹی کی قسم کیا ہے؟", reply_to="qa-answer").status_code, 204)
            with (
                patch("app.assistant_model.decide", return_value=Decision(
                    language="en", intent="profile", farm="F1", tip="none",
                )),
                patch("app.assistant_model.compose_answer",
                      side_effect=lambda fid, facts, lang, q, usage: f"{facts['field_name']} soil reply") as compose,
                patch("app.assistant_farms.live_conditions", return_value={}) as live,
            ):
                process_one()
                # The model now receives the field's full context, so weather is always gathered.
                live.assert_called()
                self.assertTrue(compose.called)
            deliver()
            recipient, answer = sender.call_args.args
            self.assertEqual(recipient, phone)
            self.assertIn(field["name"], answer)
            self.assertEqual(TestClient(app).get(conversation_path).status_code, 401)
            page = self.client.get(conversation_path, params={"limit": 2}).json()
            self.assertEqual(len(page["messages"]), 2)
            self.assertEqual({item["direction"] for item in page["messages"]}, {"inbound", "outbound"})
            older = self.client.get(conversation_path, params={"before": page["next_cursor"]}).json()
            self.assertEqual(len(older["messages"]), 5)
            self.assertNotIn("Legacy email", {item["body"] for item in older["messages"]})
            self.assertEqual(self.client.get(
                f"/api/assistant/conversations/{other['farmer']['id']}", params={"before": page["next_cursor"]},
            ).status_code, 404)
            with connect() as conn:
                self.assertEqual(conn.execute(
                    "SELECT count(*) AS n FROM assistant_jobs WHERE farmer_id=%s AND kind='inbound'", (farmer["id"],),
                ).fetchone()["n"], 2)
                self.assertEqual(conn.execute(
                    "SELECT status FROM assistant_messages WHERE farmer_id=%s AND channel='email'", (farmer["id"],),
                ).fetchone()["status"], "queued")
            timestamp = datetime.now(UTC).timestamp()
            self.assertEqual(webhook(phone, "two-plain-1", "What is the soil?", timestamp=timestamp).status_code, 204)
            self.assertEqual(webhook(phone, "two-plain-2", "What crop grows here?", timestamp=timestamp).status_code, 204)
            latest = self.client.get(conversation_path).json()["messages"]
            self.assertIn("What is the soil?", {item["body"] for item in latest})
            self.assertIn("What crop grows here?", {item["body"] for item in latest})
            with connect() as conn:
                conn.execute("UPDATE farmers SET phone='invalid' WHERE id=%s", (farmer["id"],))
                conn.execute("UPDATE farmers SET phone=%s WHERE id=%s", (farmer["phone"], farmer["id"]))
            with self.assertRaises(HTTPException), farmer_scope(farmer["id"]):
                self.fail("Restoring a previously verified number must require re-enrollment")
