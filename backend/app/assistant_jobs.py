import hashlib
import hmac
import os
import re
from datetime import datetime
from uuid import UUID, uuid4

from fastapi import HTTPException
from psycopg.errors import UniqueViolation
from psycopg.types.json import Jsonb

from . import assistant_copy as copy
from . import assistant_farms as farms
from . import assistant_model as model
from .assistant_access import enabled, farmer_scope, verified
from .database import connect
from .science.crops import CROP_NAMES, lifecycle, local_today

TOKEN = re.compile(r"(?im)^\s*(?:>\s*)?AQ-REPLY[ \t]+([0-9a-f-]{36}\.[0-9a-f]{64})[ \t]*$")
QUOTE = re.compile(r"(?m)^(?:>.*|On .* wrote:\s*)$")
HIGH_RISK = re.compile(r"\b(flood(?:ing)?|pesticide|poison(?:ing)?|electrocution|sailab|zehar)\b|سیلاب|زہر", re.IGNORECASE)
CONSENT = {"yes", "ہاں", "جی ہاں", "haan", "han"}


def signed_token(message_id):
    key = os.getenv("ASSISTANT_REPLY_SECRET", "")
    if len(key) < 32:
        raise RuntimeError("Assistant reply secret is not configured")
    digest = hmac.new(key.encode(), str(message_id).encode(), hashlib.sha256).hexdigest()
    return f"{message_id}.{digest}"


def audit(conn, action, farmer_id=None, message_id=None, **detail):
    conn.execute("INSERT INTO assistant_audit(farmer_id,message_id,action,detail) VALUES (%s,%s,%s,%s)",
                 (farmer_id, message_id, action, Jsonb(detail)))


def queue_message(conn, farmer_id, *, kind, body, dedupe, field_id=None, evidence=None, usage=None, reason=None):
    row = conn.execute(
        """INSERT INTO assistant_messages(id,farmer_id,field_id,direction,kind,status,body,
                   evidence,usage,review_reason,dedupe,channel,recipient_phone)
           SELECT %s,i.farmer_id,%s,'outbound',%s,%s,%s,%s,%s,%s,%s,'whatsapp',i.whatsapp_phone
           FROM assistant_identities i JOIN farmers f ON f.id=i.farmer_id
           WHERE i.farmer_id=%s AND i.whatsapp_phone=aquaproof_whatsapp_phone(f.phone)
             AND (%s='verify' OR i.whatsapp_verified_at IS NOT NULL)
           ON CONFLICT (dedupe) DO NOTHING RETURNING id""",
        (uuid4(), field_id, kind, "review" if reason else "queued", body,
         Jsonb(evidence or {}), Jsonb({"calls": usage or []}), reason, dedupe, farmer_id, kind),
    ).fetchone()
    if row:
        audit(conn, "review_requested" if reason else "message_queued", farmer_id, row["id"], kind=kind)
    return row


def enroll(farmer_id, language=None, field_id=None):
    try:
        with connect() as conn:
            person = conn.execute(
                "SELECT aquaproof_whatsapp_phone(phone) AS phone FROM farmers WHERE id=%s FOR UPDATE",
                (farmer_id,),
            ).fetchone()
            if not person:
                raise HTTPException(404, "Farmer not found.")
            if not person["phone"]:
                raise HTTPException(422, "Save a valid WhatsApp mobile number on the farmer profile.")
            identity = conn.execute(
                """INSERT INTO assistant_identities(farmer_id,whatsapp_phone,language) VALUES (%s,%s,%s)
                   ON CONFLICT (farmer_id) DO UPDATE SET whatsapp_phone=excluded.whatsapp_phone,
                       language=COALESCE(%s,assistant_identities.language),whatsapp_verified_at=CASE
                           WHEN assistant_identities.whatsapp_phone=excluded.whatsapp_phone
                           THEN assistant_identities.whatsapp_verified_at END
                   RETURNING whatsapp_verified_at,language""",
                (farmer_id, person["phone"], language or model.DEFAULT_LANGUAGE, language),
            ).fetchone()
            if identity["whatsapp_verified_at"]:
                return "WhatsApp enrollment is verified."
            if conn.execute(
                """SELECT 1 FROM assistant_messages WHERE farmer_id=%s AND recipient_phone=%s
                   AND channel='whatsapp' AND kind='verify' AND reply_used_at IS NULL
                   AND status IN ('queued','sending','sent') AND created_at>now()-interval '15 minutes'""",
                (farmer_id, person["phone"]),
            ).fetchone():
                return "WhatsApp verification was requested recently."
            request = queue_message(conn, farmer_id, kind="verify", body=copy.template(identity["language"], "verify"),
                                    dedupe=f"verify:wa:{uuid4()}", field_id=field_id)
            if request:
                audit(conn, "whatsapp_enrollment_requested", farmer_id, request["id"])
    except UniqueViolation:
        raise HTTPException(409, "This WhatsApp number is already registered to another farmer.") from None
    return "WhatsApp verification queued."


def waha_reply_context(conn, sender, received_at, consent, reply_to):
    identity = conn.execute(
        """SELECT i.farmer_id,i.language,i.whatsapp_verified_at
           FROM assistant_identities i JOIN farmers f ON f.id=i.farmer_id
           WHERE i.whatsapp_phone=%s AND i.whatsapp_phone=aquaproof_whatsapp_phone(f.phone)
           FOR UPDATE OF i""", (sender,),
    ).fetchone()
    if not identity:
        return None
    farmer = identity["farmer_id"]
    if not identity["whatsapp_verified_at"]:
        if not consent:
            return None
        pending = conn.execute(
            """SELECT id,field_id FROM assistant_messages
               WHERE farmer_id=%s AND recipient_phone=%s AND channel='whatsapp'
                 AND direction='outbound' AND kind='verify' AND status='sent'
                 AND whatsapp_transport='waha' AND reply_used_at IS NULL
                 AND delivered_at>now()-interval '7 days' AND date_trunc('second',delivered_at)<=%s
               ORDER BY delivered_at DESC,id DESC LIMIT 1 FOR UPDATE""", (farmer, sender, received_at),
        ).fetchone()
        return {**identity, **pending, "kind": "verify"} if pending else None
    if received_at < identity["whatsapp_verified_at"].replace(microsecond=0):
        return None
    context = conn.execute(
        """SELECT m.field_id FROM assistant_messages m JOIN fields f ON f.id=m.field_id
           WHERE m.farmer_id=%s AND m.recipient_phone=%s AND m.channel='whatsapp'
             AND f.farmer_id=m.farmer_id AND f.archived_at IS NULL
             AND m.status IN ('sent','received')
             AND date_trunc('second',coalesce(m.delivered_at,m.created_at))<=%s
           ORDER BY (m.direction='outbound' AND m.provider_message_id IS NOT DISTINCT FROM %s
                     AND %s::text IS NOT NULL) DESC,
                    coalesce(m.delivered_at,m.created_at) DESC,m.id DESC LIMIT 1""",
        (farmer, sender, received_at, reply_to, reply_to),
    ).fetchone()
    return {**identity, "id": None, "kind": "reply", "field_id": context["field_id"] if context else None}


def accept_message(sender, message_key, body, quote=None, reply_to=None, *, transport=None, received_at=None):
    matches = TOKEN.findall(body) + TOKEN.findall((quote or "")[:8192])
    cleaned = QUOTE.sub("", TOKEN.sub("", body)).strip()[:2400]
    if not cleaned:
        return False
    consent = cleaned.casefold() in CONSENT
    direct = transport == "waha" and received_at is not None
    issued_id = None
    try:
        if not direct and not matches and reply_to:
            # Resolve ID-only quotes for this direct chat, then apply the normal expiry and ownership checks.
            with connect() as conn:
                issued = conn.execute(
                    """SELECT id FROM assistant_messages WHERE provider_message_id=%s AND recipient_phone=%s
                       AND channel='whatsapp' AND direction='outbound'
                       AND whatsapp_transport IS NOT DISTINCT FROM %s
                       ORDER BY created_at DESC LIMIT 1""", (reply_to, sender, transport),
                ).fetchone()
            if issued:
                matches = [signed_token(issued["id"])]
        if not direct and matches:
            if len(set(matches)) != 1:
                return False
            issued_id = UUID(matches[0].split(".", 1)[0])
            if not hmac.compare_digest(signed_token(issued_id), matches[0]):
                return False
        elif not direct:
            return False
    except (ValueError, RuntimeError):
        return False

    with connect() as conn:
        row = waha_reply_context(conn, sender, received_at, consent, reply_to) if direct else conn.execute(
            """SELECT m.id,m.farmer_id,m.kind,m.field_id,i.language,i.whatsapp_verified_at
               FROM assistant_messages m JOIN assistant_identities i ON i.farmer_id=m.farmer_id
               JOIN farmers f ON f.id=m.farmer_id
               WHERE m.direction='outbound' AND m.channel='whatsapp' AND m.status='sent'
                 AND m.reply_used_at IS NULL AND m.delivered_at > now() - interval '7 days'
                 AND m.recipient_phone=i.whatsapp_phone AND i.whatsapp_phone=%s
                 AND i.whatsapp_phone=aquaproof_whatsapp_phone(f.phone)
                 AND m.id=%s
                 AND ((m.kind='verify' AND i.whatsapp_verified_at IS NULL AND %s)
                      OR (m.kind<>'verify' AND i.whatsapp_verified_at IS NOT NULL))
               ORDER BY m.delivered_at DESC,m.id DESC LIMIT 1 FOR UPDATE OF m,i""",
            (sender, issued_id, consent),
        ).fetchone()
        if not row:
            return False
        issued_id = row["id"]
        farmer = row["farmer_id"]
        field_id = row["field_id"]
        if field_id and not conn.execute(
            "SELECT 1 FROM fields WHERE id=%s AND farmer_id=%s AND archived_at IS NULL",
            (field_id, farmer),
        ).fetchone():
            field_id = None
        inbound_key = "inbound:" + farmer + ":" + hashlib.sha256(message_key.encode()).hexdigest()
        message = conn.execute(
            """INSERT INTO assistant_messages(id,farmer_id,field_id,direction,kind,status,body,dedupe,
                   recipient_phone,provider_message_id,whatsapp_transport,created_at)
               VALUES (%s,%s,%s,'inbound',%s,'received',%s,%s,%s,%s,%s,COALESCE(%s,now()))
               ON CONFLICT(dedupe) DO NOTHING RETURNING id""",
            (uuid4(), farmer, field_id, "verify" if row["kind"] == "verify" else "reply",
             model.clean(cleaned), inbound_key, sender, message_key, transport,
             received_at),
        ).fetchone()
        if not message:
            return False
        if issued_id:
            conn.execute("UPDATE assistant_messages SET reply_used_at=now() WHERE id=%s", (issued_id,))
        audit(conn, "authenticated_inbound", farmer, message["id"])
        if row["kind"] != "verify" and cleaned.casefold() in ("stop", "unsubscribe", "band", "بند"):
            conn.execute("UPDATE assistant_identities SET whatsapp_verified_at=NULL WHERE farmer_id=%s", (farmer,))
            conn.execute(
                """UPDATE assistant_messages
                   SET status=CASE WHEN status IN ('queued','review') THEN 'cancelled' ELSE status END,
                       reply_used_at=CASE WHEN kind='verify' THEN now() ELSE reply_used_at END,updated_at=now()
                   WHERE farmer_id=%s AND channel='whatsapp' AND direction='outbound'
                     AND (status IN ('queued','review') OR kind='verify')""", (farmer,),
            )
            audit(conn, "farmer_unsubscribed", farmer, message["id"])
            return True
        if row["kind"] == "verify":
            conn.execute("UPDATE assistant_identities SET whatsapp_verified_at=now() WHERE farmer_id=%s", (farmer,))
            queue_message(conn, farmer, kind="reply", body=copy.template(row["language"], "verified"),
                          dedupe=f"verified:{message['id']}", field_id=field_id)
        else:
            conn.execute(
                """INSERT INTO assistant_jobs(farmer_id,field_id,kind,inbound_id,local_day,dedupe)
                   VALUES (%s,%s,'inbound',%s,%s,%s)""",
                (farmer, field_id, message["id"], local_today(), "job:" + str(message["id"])),
            )
    return True


def schedule(now=None):
    if not enabled():
        return
    now = now or datetime.now(farms.weather.LOCAL_ZONE)
    if now.hour < 7:
        return
    with connect() as conn:
        conn.execute("DELETE FROM assistant_model_limits WHERE bucket < now() - interval '2 days'")
        conn.execute(
            """INSERT INTO assistant_jobs(farmer_id,field_id,kind,local_day,dedupe)
               SELECT i.farmer_id,f.id,'daily',%s,'daily:wa:'||f.id||':'||%s
               FROM assistant_identities i JOIN farmers p ON p.id=i.farmer_id
               JOIN fields f ON f.farmer_id=i.farmer_id
               WHERE i.whatsapp_verified_at IS NOT NULL AND i.whatsapp_phone=aquaproof_whatsapp_phone(p.phone) AND f.archived_at IS NULL
               ON CONFLICT(dedupe) DO NOTHING""",
            (now.date(), now.date().isoformat()),
        )
        if now.hour >= 10:
            slot = f"{now.date()}:{(now.hour - 10)//3}"
            conn.execute(
                """INSERT INTO assistant_jobs(farmer_id,field_id,kind,local_day,dedupe)
                   SELECT j.farmer_id,j.field_id,'correction',j.local_day,'correction:'||j.field_id||':'||%s
                   FROM assistant_jobs j JOIN fields f ON f.id=j.field_id AND f.farmer_id=j.farmer_id
                   JOIN assistant_identities i ON i.farmer_id=j.farmer_id
                   JOIN farmers p ON p.id=i.farmer_id
                   WHERE j.kind='daily' AND j.channel='whatsapp' AND j.status='done' AND j.local_day=%s AND f.archived_at IS NULL
                     AND i.whatsapp_verified_at IS NOT NULL AND i.whatsapp_phone=aquaproof_whatsapp_phone(p.phone)
                   ON CONFLICT(dedupe) DO NOTHING""",
                (slot, now.date()),
            )


def claim_job():
    with connect() as conn:
        conn.execute("""UPDATE assistant_jobs SET status='failed',error='Attempts exhausted'
                        WHERE status='running' AND attempt>=3 AND claimed_at<now()-interval '10 minutes'""")
        return conn.execute(
            """WITH pick AS (
                SELECT id FROM assistant_jobs
                WHERE channel='whatsapp' AND attempt<3 AND available_at<=now() AND
                      (status='queued' OR (status='running' AND claimed_at<now()-interval '10 minutes'))
                ORDER BY CASE kind WHEN 'inbound' THEN 0 WHEN 'daily' THEN 1 ELSE 2 END,available_at,id
                LIMIT 1 FOR UPDATE SKIP LOCKED
            )
            UPDATE assistant_jobs j SET status='running',attempt=j.attempt+1,claimed_at=now()
            FROM pick WHERE j.id=pick.id RETURNING j.*""",
        ).fetchone()


def state_for(job):
    farmer = job["farmer_id"]
    with connect() as conn:
        identity = verified(conn, farmer)
    if not identity:
        return None
    if job["kind"] != "inbound" and job["local_day"] != local_today():
        return None
    all_farms = farms.owned_farms(farmer)
    if job["kind"] != "inbound":
        all_farms = [farm for farm in all_farms if farm["id"] == job["field_id"]]
    aliases = {f"F{index}": entry for index, entry in enumerate(all_farms[:80], 1)}
    default = next((alias for alias, entry in aliases.items() if job["field_id"] == entry["id"]), None)
    if default is None and len(aliases) == 1:
        default = next(iter(aliases))
    if not aliases and job["kind"] != "inbound":
        return None
    recent = []
    message = ""
    if job["inbound_id"]:
        with farmer_scope(farmer) as conn:
            raw = conn.execute(
                """SELECT body FROM assistant_messages WHERE id=%s AND farmer_id=%s
                   AND channel='whatsapp' AND recipient_phone=%s AND direction='inbound' AND kind='reply'""", (job["inbound_id"], farmer, identity["whatsapp_phone"]),
            ).fetchone()
            if not raw:
                return None
            message = raw["body"]
            mentions = [alias for alias, item in aliases.items()
                        if len(item["name"].strip()) >= 3 and item["name"].casefold() in message.casefold()]
            if len(mentions) == 1:
                default = mentions[0]
            recent = [row["body"] for row in conn.execute(
                """SELECT body FROM assistant_messages WHERE farmer_id=%s AND id<>%s
                   AND channel='whatsapp' AND recipient_phone=%s AND direction='inbound' AND kind='reply' AND (field_id IS NULL OR field_id=%s)
                   ORDER BY created_at DESC LIMIT 4""",
                (farmer, job["inbound_id"], identity["whatsapp_phone"], job["field_id"]),
            ).fetchall()][::-1]
    return identity, aliases, default, message, recent


def compute(job, state):
    identity, aliases, default, message, recent = state
    ctx = model.ToolContext(job["farmer_id"], aliases, job["kind"])
    usage = []
    prepared = {}
    if job["kind"] != "inbound":
        prepared = ctx.plan(ctx.owned(default))
        if job["kind"] == "correction":
            with farmer_scope(job["farmer_id"]) as conn:
                last = conn.execute(
                    """SELECT evidence FROM assistant_messages WHERE farmer_id=%s AND field_id=%s
                       AND channel='whatsapp' AND kind IN ('daily','correction') AND status IN ('queued','sent','review')
                       AND (created_at AT TIME ZONE 'Asia/Karachi')::date=%s
                       ORDER BY created_at DESC LIMIT 1""",
                    (job["farmer_id"], job["field_id"], job["local_day"]),
                ).fetchone()
            if last and not farms.changed(last["evidence"], prepared):
                return None
        recent = [model.json_dump({key: prepared[key] for key in
                  ("today", "missing", "risks", "uncertain_rain") if key in prepared})]
    if job["kind"] == "inbound" and HIGH_RISK.search(message):
        decision = model.Decision(language=identity["language"], intent="escalate", farm=default, tip="none")
    else:
        decision = model.decide(ctx, message, recent, default, identity["language"], usage)
    intent = decision.intent if job["kind"] == "inbound" else "recommendation"
    selected = default if job["kind"] != "inbound" else decision.farm or default
    language = identity["language"]
    field_id = aliases[selected]["id"] if selected else None
    evidence = {}
    observation = None
    reason = None
    if ctx.escalation or intent == "escalate":
        reason = "Unsupported or high-risk request"
        body = copy.template(language, "review")
    elif not selected:
        body = copy.template(language, "clarify" if aliases else "no_field")
    elif intent == "clarify":
        body = copy.field_message(aliases[selected]["name"], copy.template(language, "clarify_topic"))
    else:
        farm = ctx.owned(selected)
        name = aliases[selected]["name"]
        if intent != "profile":
            evidence = ctx.live(farm)
        if intent == "observation":
            if ctx.proposal and ctx.proposal[0] == selected:
                observation = ctx.proposal[1].model_dump(mode="json")
                body = copy.template(language, "observation")
            else:
                body = copy.field_message(name, copy.template(language, "clarify_topic"))
        elif intent == "history":
            records = farms.history(job["farmer_id"], field_id)
            evidence = {**evidence, **records}
            body = copy.field_message(name, copy.history_report(language, records))
        elif intent == "profile":
            profile = {key: farm[key] for key in ("crop", "soil", "source")}
            evidence = {**evidence, "profile": profile}
            body = copy.field_message(name, copy.profile_report(language, profile))
        elif intent == "weather":
            forecast = evidence["weather_forecast"] or evidence["forecast"]
            if forecast:
                body = copy.field_message(name, copy.weather_report(language, forecast["daily"][0]))
            else:
                body = copy.report(language, name, {"missing": ["weather"]})
        elif intent == "crop":
            crop = CROP_NAMES.get((farm["crop"] or "").casefold())
            if crop and farm["planted"]:
                estimate = lifecycle(crop, farm["planted"], local_today())
                evidence = {**evidence, "crop_lifecycle": model.json_dump(estimate)}
                body = copy.field_message(
                    name, copy.template(language, "crop").format(
                        stage=copy.stage_name(language, estimate["current_stage"]),
                    ),
                )
            else:
                body = copy.report(language, name, {"missing": ["crop"]})
        elif intent == "harvest":
            info = ctx.harvest(farm)
            evidence = {**evidence, "harvest": info}
            body = copy.field_message(name, copy.harvest_report(language, info))
        else:
            evidence = ctx.plan(farm)
            if intent == "outlook" and not evidence.get("missing"):
                body = copy.field_message(name, copy.outlook(language, evidence))
            else:
                body = copy.report(language, name, evidence, decision.tip)
            if evidence.get("requires_review"):
                reason = "Forecast hazard, crop stress, salinity, or crop-model limitations"
            # Proactive harvest alert on scheduled advisories when the crop is ripe and rain threatens.
            if job["kind"] != "inbound":
                harvest_info = ctx.harvest(farm)
                alert = copy.harvest_alert(language, harvest_info)
                if alert:
                    body = f"{alert}\n{body}"
                    evidence = {**evidence, "harvest": harvest_info.get("recommendation")}
    return field_id, language, body, evidence, usage, reason, observation


def process_one():
    if not enabled() or not (job := claim_job()):
        return
    try:
        state = state_for(job)
        result = compute(job, state) if state else None
        with connect() as conn:
            locked = conn.execute(
                """SELECT id FROM assistant_jobs WHERE id=%s AND attempt=%s AND status='running' FOR UPDATE""",
                (job["id"], job["attempt"]),
            ).fetchone()
            if not locked:
                return
            farmer = job["farmer_id"]
            identity = verified(conn, farmer, lock=True) if result else None
            if identity and identity["whatsapp_phone"] == state[0]["whatsapp_phone"]:
                field_id, language, body, evidence, usage, reason, observation = result
                if identity["language"] != language:
                    conn.execute(
                        "UPDATE assistant_jobs SET status='queued',attempt=attempt-1 WHERE id=%s",
                        (job["id"],),
                    )
                    return
                if field_id and not conn.execute(
                    "SELECT 1 FROM fields WHERE id=%s AND farmer_id=%s AND archived_at IS NULL FOR UPDATE",
                    (field_id, farmer),
                ).fetchone():
                    raise HTTPException(403, "Field is outside the verified farmer scope.")
                if observation:
                    conn.execute(
                        """INSERT INTO assistant_observations(farmer_id,field_id,inbound_id,measurements)
                           VALUES (%s,%s,%s,%s) ON CONFLICT(inbound_id) DO NOTHING""",
                        (farmer, field_id, job["inbound_id"], Jsonb(observation)),
                    )
                    audit(conn, "observation_queued", farmer, job["inbound_id"])
                if job["inbound_id"] and field_id:
                    conn.execute("UPDATE assistant_messages SET field_id=%s WHERE id=%s AND farmer_id=%s",
                                 (field_id, job["inbound_id"], farmer))
                if job["kind"] == "correction":
                    last = conn.execute(
                        """SELECT evidence FROM assistant_messages WHERE farmer_id=%s AND field_id=%s
                           AND channel='whatsapp' AND kind IN ('daily','correction') AND status IN ('queued','sent','review')
                           AND (created_at AT TIME ZONE 'Asia/Karachi')::date=%s
                           ORDER BY created_at DESC LIMIT 1""", (farmer, field_id, job["local_day"]),
                    ).fetchone()
                    if last and not farms.changed(last["evidence"], evidence):
                        conn.execute("UPDATE assistant_jobs SET status='done' WHERE id=%s", (job["id"],))
                        return
                    conn.execute(
                        """UPDATE assistant_messages SET status='cancelled',updated_at=now()
                           WHERE farmer_id=%s AND field_id=%s AND status IN ('queued','review')
                             AND channel='whatsapp' AND kind IN ('daily','correction')""", (farmer, field_id),
                    )
                queued = queue_message(
                    conn, farmer, kind="reply" if job["kind"] == "inbound" else job["kind"],
                    body=body, evidence=evidence, usage=usage, reason=reason, field_id=field_id,
                    dedupe=job["dedupe"],
                )
                if queued and reason and job["kind"] == "inbound":
                    queue_message(conn, farmer, kind="reply", body=copy.template(language, "review"),
                                  field_id=field_id, dedupe="review-ack:" + job["dedupe"])
            conn.execute("UPDATE assistant_jobs SET status='done',error=NULL WHERE id=%s", (job["id"],))
    except Exception as error:  # noqa: BLE001 - isolate worker failures and record only the error type
        # The error type gives officers a diagnostic without leaking a farmer message or API URL.
        with connect() as conn:
            conn.execute(
                """UPDATE assistant_jobs SET status=CASE WHEN attempt>=3 THEN 'failed' ELSE 'queued' END,
                          available_at=now()+attempt*interval '2 minutes',error=%s
                   WHERE id=%s AND attempt=%s AND status='running'""",
                (type(error).__name__, job["id"], job["attempt"]),
            )
