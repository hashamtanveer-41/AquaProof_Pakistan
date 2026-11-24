import hashlib
import hmac
import os
import re
from datetime import datetime
from uuid import UUID, uuid4

from fastapi import HTTPException
from psycopg.types.json import Jsonb

from . import assistant_copy as copy
from . import assistant_farms as farms
from . import assistant_model as model
from .assistant_access import enabled, farmer_scope, verified
from .database import connect
from .science.crops import local_today

TOKEN = re.compile(r"(?im)^\s*(?:>\s*)?AQ-REPLY[ \t]+([0-9a-f-]{36}\.[0-9a-f]{64})[ \t]*$")
QUOTE = re.compile(r"(?m)^(?:>.*|On .* wrote:\s*)$")
HIGH_RISK = re.compile(r"\b(flood(?:ing)?|pesticide|poison(?:ing)?|electrocution|sailab|zehar)\b|سیلاب|زہر", re.I)


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
                   evidence,usage,review_reason,dedupe)
           VALUES (%s,%s,%s,'outbound',%s,%s,%s,%s,%s,%s,%s)
           ON CONFLICT (dedupe) DO NOTHING RETURNING id""",
        (uuid4(), farmer_id, field_id, kind, "review" if reason else "queued", body,
         Jsonb(evidence or {}), Jsonb({"calls": usage or []}), reason, dedupe),
    ).fetchone()
    if row:
        audit(conn, "review_requested" if reason else "message_queued", farmer_id, row["id"], kind=kind)
    return row


def enroll(farmer_id, language, field_id=None):
    try:
        signed_token(uuid4())
    except RuntimeError:
        raise HTTPException(503, "Configure the reply authentication secret first.") from None
    with connect() as conn:
        person = conn.execute("SELECT id,lower(email) AS email FROM farmers WHERE id=%s", (farmer_id,)).fetchone()
        if not person:
            raise HTTPException(404, "Farmer not found")
        if conn.execute("SELECT 1 FROM assistant_identities WHERE email=%s AND farmer_id<>%s",
                        (person["email"], farmer_id)).fetchone():
            raise HTTPException(409, "This mailbox is already registered to another farmer.")
        conn.execute(
            """INSERT INTO assistant_identities(farmer_id,email,language) VALUES (%s,%s,%s)
               ON CONFLICT (farmer_id) DO UPDATE SET email=excluded.email,language=excluded.language,
                   verified_at=CASE WHEN assistant_identities.email=excluded.email
                                    THEN assistant_identities.verified_at ELSE NULL END""",
            (farmer_id, person["email"], language),
        )
        queue_message(conn, farmer_id, kind="verify", body=copy.template(language, "verify"),
                      dedupe=f"verify:{farmer_id}:{person['email']}:{local_today()}", field_id=field_id)
        audit(conn, "enrollment_requested", farmer_id)


def accept_message(sender, message_key, body):
    matches = TOKEN.findall(body)
    if len(set(matches)) != 1:
        return False
    try:
        issued_id = UUID(matches[0].split(".", 1)[0])
        if not hmac.compare_digest(signed_token(issued_id), matches[0]):
            return False
    except (ValueError, RuntimeError):
        return False

    cleaned = QUOTE.sub("", TOKEN.sub("", body)).strip()[:2400]
    with connect() as conn:
        row = conn.execute(
            """SELECT m.id,m.farmer_id,m.kind,m.field_id,i.language,i.verified_at
               FROM assistant_messages m JOIN assistant_identities i ON i.farmer_id=m.farmer_id
               JOIN farmers f ON f.id=m.farmer_id
               WHERE m.id=%s AND m.direction='outbound' AND m.status='sent'
                 AND m.reply_used_at IS NULL AND m.delivered_at > now() - interval '7 days'
                 AND m.recipient_email=i.email AND i.email=%s AND i.email=lower(f.email)
               FOR UPDATE OF m,i""", (issued_id, sender.casefold()),
        ).fetchone()
        if not row or (row["kind"] != "verify" and (not row["verified_at"] or not cleaned)):
            return False
        farmer = row["farmer_id"]
        field_id = row["field_id"]
        if field_id and not conn.execute(
            "SELECT 1 FROM fields WHERE id=%s AND farmer_id=%s AND archived_at IS NULL",
            (field_id, farmer),
        ).fetchone():
            field_id = None
        inbound_key = "inbound:" + farmer + ":" + hashlib.sha256(message_key.encode()).hexdigest()
        message = conn.execute(
            """INSERT INTO assistant_messages(id,farmer_id,field_id,direction,kind,status,body,dedupe)
               VALUES (%s,%s,%s,'inbound',%s,'received',%s,%s)
               ON CONFLICT(dedupe) DO NOTHING RETURNING id""",
            (uuid4(), farmer, field_id, "verify" if row["kind"] == "verify" else "reply",
             "" if row["kind"] == "verify" else model.clean(cleaned), inbound_key),
        ).fetchone()
        if not message:
            return False
        conn.execute("UPDATE assistant_messages SET reply_used_at=now() WHERE id=%s", (issued_id,))
        audit(conn, "authenticated_inbound", farmer, message["id"])
        if row["kind"] != "verify" and cleaned.casefold() in ("stop", "unsubscribe", "band", "بند"):
            conn.execute("UPDATE assistant_identities SET verified_at=NULL WHERE farmer_id=%s", (farmer,))
            conn.execute(
                """UPDATE assistant_messages SET status='cancelled',updated_at=now() WHERE farmer_id=%s
                   AND direction='outbound' AND status IN ('queued','review')""", (farmer,),
            )
            audit(conn, "farmer_unsubscribed", farmer, message["id"])
            return True
        if row["kind"] == "verify":
            conn.execute("UPDATE assistant_identities SET verified_at=now() WHERE farmer_id=%s", (farmer,))
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
               SELECT i.farmer_id,f.id,'daily',%s,'daily:'||f.id||':'||%s
               FROM assistant_identities i JOIN farmers p ON p.id=i.farmer_id
               JOIN fields f ON f.farmer_id=i.farmer_id
               WHERE i.verified_at IS NOT NULL AND i.email=lower(p.email) AND f.archived_at IS NULL
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
                   WHERE j.kind='daily' AND j.status='done' AND j.local_day=%s AND f.archived_at IS NULL
                     AND i.verified_at IS NOT NULL AND i.email=lower(p.email)
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
                WHERE attempt<3 AND available_at<=now() AND
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
    if not aliases:
        return None
    recent = []
    message = ""
    if job["inbound_id"]:
        with farmer_scope(farmer) as conn:
            raw = conn.execute(
                """SELECT body FROM assistant_messages WHERE id=%s AND farmer_id=%s
                   AND direction='inbound' AND kind='reply'""", (job["inbound_id"], farmer),
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
                   AND direction='inbound' AND kind='reply' AND (field_id IS NULL OR field_id=%s)
                   ORDER BY created_at DESC LIMIT 4""",
                (farmer, job["inbound_id"], job["field_id"]),
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
                       AND kind IN ('daily','correction') AND status IN ('queued','sent','review')
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
    language = decision.language
    field_id = aliases[selected]["id"] if selected else None
    evidence = {}
    observation = None
    reason = None
    if ctx.escalation or intent == "escalate":
        reason = "Unsupported or high-risk request"
        body = copy.template(language, "review")
    elif not selected or intent == "clarify":
        body = copy.template(language, "clarify")
    else:
        farm = ctx.owned(selected)
        if intent == "observation":
            if ctx.proposal and ctx.proposal[0] == selected:
                observation = ctx.proposal[1].model_dump(mode="json")
                body = copy.template(language, "observation")
            else:
                body = copy.template(language, "clarify")
        elif intent == "history":
            evidence = farms.history(job["farmer_id"], field_id)
            count = sum(len(rows) for rows in evidence.values())
            body = copy.template(language, "history").format(count=count)
        elif intent == "weather":
            try:
                evidence = {"forecast": farms.fresh_forecast(farm)}
                body = copy.weather_report(language, evidence["forecast"]["daily"][0])
            except HTTPException:
                body = copy.report(language, aliases[selected]["name"], {"missing": ["weather"]})
        else:
            evidence = ctx.plan(farm)
            body = copy.report(language, aliases[selected]["name"], evidence, decision.tip)
            if evidence.get("requires_review"):
                reason = "Forecast hazard, crop stress, or rainfall-sensitive irrigation"
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
            if result and verified(conn, farmer):
                field_id, language, body, evidence, usage, reason, observation = result
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
                conn.execute("UPDATE assistant_identities SET language=%s WHERE farmer_id=%s", (language, farmer))
                if job["inbound_id"] and field_id:
                    conn.execute("UPDATE assistant_messages SET field_id=%s WHERE id=%s AND farmer_id=%s",
                                 (field_id, job["inbound_id"], farmer))
                if job["kind"] == "correction":
                    last = conn.execute(
                        """SELECT evidence FROM assistant_messages WHERE farmer_id=%s AND field_id=%s
                           AND kind IN ('daily','correction') AND status IN ('queued','sent','review')
                           AND (created_at AT TIME ZONE 'Asia/Karachi')::date=%s
                           ORDER BY created_at DESC LIMIT 1""", (farmer, field_id, job["local_day"]),
                    ).fetchone()
                    if last and not farms.changed(last["evidence"], evidence):
                        conn.execute("UPDATE assistant_jobs SET status='done' WHERE id=%s", (job["id"],))
                        return
                    conn.execute(
                        """UPDATE assistant_messages SET status='cancelled',updated_at=now()
                           WHERE farmer_id=%s AND field_id=%s AND status IN ('queued','review')
                             AND kind IN ('daily','correction')""", (farmer, field_id),
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
    except Exception as error:
        # The error type gives officers a diagnostic without leaking a farmer message or API URL.
        with connect() as conn:
            conn.execute(
                """UPDATE assistant_jobs SET status=CASE WHEN attempt>=3 THEN 'failed' ELSE 'queued' END,
                          available_at=now()+attempt*interval '2 minutes',error=%s
                   WHERE id=%s AND attempt=%s AND status='running'""",
                (type(error).__name__, job["id"], job["attempt"]),
            )
