import os
from datetime import UTC, datetime
from unittest import TestCase, skipUnless
from unittest.mock import patch
from urllib.parse import urlsplit
from uuid import uuid4

from fastapi import HTTPException
from fastapi.testclient import TestClient

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
from app.science.weather import LOCAL_ZONE

DATABASE = os.getenv("AQUAPROOF_TEST_DATABASE_URL", "")


@skipUnless(DATABASE, "Requires a disposable PostGIS database in AQUAPROOF_TEST_DATABASE_URL")
class PostgisTests(TestCase):
    def setUp(self):
        self.assertTrue(urlsplit(DATABASE).path.startswith("/aquaproof_test"), "Use a dedicated QA database")
        secret = "qa" * 24
        env = patch.dict(os.environ, {"DATABASE_URL": DATABASE, "ASSISTANT_OFFICER_TOKEN": secret,
                                      "ASSISTANT_ENABLED": "1", "AQUAPROOF_BACKGROUND_WHATSAPP": "0"})
        env.start()
        self.addCleanup(env.stop)
        self.client = TestClient(app, headers={"Authorization": "Bearer " + secret})
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
            self.assertEqual(conn.execute("SELECT COUNT(*) AS count FROM schema_migrations").fetchone()["count"], 12)
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
        with (
            patch.dict(os.environ, {"ASSISTANT_REPLY_SECRET": "qa-only-" * 5}),
            patch("app.green_api.settings") as settings,
        ):
            sender = settings.return_value.send
            sender.return_value = "qa-outbound"
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
                    "SELECT id,status,provider_message_id FROM assistant_messages WHERE farmer_id=%s AND kind='verify'",
                    (farmer["id"],),
                ).fetchone()
            self.assertEqual((message["status"], message["provider_message_id"]), ("sent", "qa-outbound"))
            sender.assert_called_once()
            destination, body = sender.call_args.args
            self.assertEqual(destination, phone)
            self.assertIn("ہاں", body)
            token = "AQ-REPLY " + signed_token(message["id"])
            self.assertIn(token, body)
            self.assertFalse(accept_message("923999999999", "other", "YES", body))
            self.assertFalse(accept_message("923999999999", "other-quote", "YES", reply_to="qa-outbound"))
            self.assertFalse(accept_message(phone, "decline", "No", body))
            self.assertTrue(accept_message(phone, "verification", "ہاں", reply_to="qa-outbound"))
            self.assertFalse(accept_message(phone, "replay", "YES", body))
            deliver()
            _, question_context = sender.call_args.args
            self.assertTrue(accept_message(phone, "question", "میرے کھیت میں بارش ہوگی؟", question_context))
            self.assertFalse(accept_message(phone, "question", "میرے کھیت میں بارش ہوگی؟", question_context))
            now = datetime.now(UTC).isoformat()
            forecast = {"source": "Mock OpenWeather", "retrieved_at": now, "daily": [
                {"rain_mm": 1.5, "precip_probability_pct": 60},
            ]}
            with (
                patch("app.assistant_model.config", return_value=None),
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
            deliver()
            recipient, answer = sender.call_args.args
            self.assertEqual(recipient, phone)
            self.assertIn(field["name"], answer)
            self.assertNotIn(other["field"]["name"], answer)
            self.assertIn("بارش متوقع ہے", answer)
            self.assertNotIn("60%", answer)
            self.assertIn("AQ-REPLY", answer)
            self.assertTrue(accept_message(phone, "follow-up", "مٹی کی قسم کیا ہے؟", answer))
            with (
                patch("app.assistant_model.decide", return_value=Decision(
                    language="en", intent="profile", farm="F1", tip="none",
                )),
                patch("app.assistant_farms.live_conditions", return_value={}) as live,
            ):
                process_one()
                self.assertEqual(live.call_args.args[0]["id"], field["id"])
            deliver()
            recipient, answer = sender.call_args.args
            self.assertEqual(recipient, phone)
            self.assertIn("مٹی کی قسم", answer)
            self.assertIn("میرا مٹی", answer)
            with connect() as conn:
                self.assertEqual(conn.execute(
                    "SELECT count(*) AS n FROM assistant_jobs WHERE farmer_id=%s AND kind='inbound'", (farmer["id"],),
                ).fetchone()["n"], 2)
                self.assertEqual(conn.execute(
                    "SELECT status FROM assistant_messages WHERE farmer_id=%s AND channel='email'", (farmer["id"],),
                ).fetchone()["status"], "queued")
                conn.execute("UPDATE farmers SET phone='invalid' WHERE id=%s", (farmer["id"],))
                conn.execute("UPDATE farmers SET phone=%s WHERE id=%s", (farmer["phone"], farmer["id"]))
            with self.assertRaises(HTTPException), farmer_scope(farmer["id"]):
                self.fail("Restoring a previously verified number must require re-enrollment")
