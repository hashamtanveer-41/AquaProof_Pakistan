import json
import os

from fastapi import APIRouter, HTTPException, Request, Response
from starlette.concurrency import run_in_threadpool

from . import waha
from .assistant_access import enabled
from .assistant_farms import delivery_evidence_is_current
from .assistant_jobs import accept_message, audit
from .database import connect
from .service_http import ProviderError

webhooks = APIRouter(include_in_schema=False)


def worker_enabled():
    return enabled() and os.getenv("AQUAPROOF_BACKGROUND_WHATSAPP", "0") == "1"


def consume(service, event):
    message = service.incoming_text(event)
    if not message:
        return
    received_at = waha.received_time(event["payload"].get("timestamp"))
    if accept_message(*message, transport="waha", received_at=received_at):
        return
    sender, _, body, quote, reply_to = message
    if not (received_at or reply_to or "AQ-REPLY" in (quote or "").upper() or "AQ-REPLY" in body.upper()):
        return
    # A webhook can arrive before the send transaction has recorded the provider ID.
    with connect() as conn:
        sending = conn.execute(
            """SELECT 1 FROM assistant_messages WHERE channel='whatsapp' AND direction='outbound'
               AND status='sending' AND recipient_phone=%s AND updated_at>now()-interval '1 minute' LIMIT 1""",
            (sender,),
        ).fetchone()
    if sending:
        raise HTTPException(503, "Outbound message is still being recorded.")


def sync_conversation(farmer_id):
    service = waha.settings()
    if not service or not worker_enabled():
        return "local"
    with connect() as conn:
        context = conn.execute(
            """SELECT i.whatsapp_phone AS phone,
                      greatest(i.whatsapp_verified_at,now()-interval '7 days') AS since,
                      i.whatsapp_verified_at AS verified_at,
                      min(m.delivered_at) AS pending_since
               FROM assistant_identities i JOIN farmers f ON f.id=i.farmer_id
               LEFT JOIN assistant_messages m ON m.farmer_id=i.farmer_id AND m.recipient_phone=i.whatsapp_phone
                 AND m.channel='whatsapp' AND m.direction='outbound' AND m.status='sent' AND m.kind='verify'
                 AND m.whatsapp_transport='waha' AND m.reply_used_at IS NULL
                 AND m.delivered_at>now()-interval '7 days'
               WHERE i.farmer_id=%s AND i.whatsapp_phone=aquaproof_whatsapp_phone(f.phone)
               GROUP BY i.whatsapp_phone,i.whatsapp_verified_at""", (farmer_id,),
        ).fetchone()
    if not context:
        return "local"
    since = context["since"] if context["verified_at"] else context["pending_since"]
    if since is None:
        return "local"
    messages = service.recent_inbound(context["phone"], since)
    for payload in sorted(messages, key=lambda item: item["timestamp"]):
        message = service.incoming_text({"event": "message", "session": service.session, "payload": payload})
        if message and message[0] == context["phone"]:
            accept_message(*message, transport="waha", received_at=waha.received_time(payload["timestamp"]))
    return "synchronized"


@webhooks.post("/webhooks/waha", status_code=204)
async def receive(request: Request):
    service = waha.settings()
    if not service:
        raise HTTPException(404)
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > 256 * 1024:
            raise HTTPException(413)
        body.extend(chunk)
    if not service.authenticated(body, request.headers.get("X-Webhook-Hmac-Algorithm", ""),
                                 request.headers.get("X-Webhook-Hmac", "")):
        raise HTTPException(401)
    if not worker_enabled():
        raise HTTPException(503, "WhatsApp processing is paused.")
    try:
        event = json.loads(body)
    except (UnicodeError, ValueError, RecursionError):
        raise HTTPException(400, "Invalid webhook JSON.") from None
    try:
        await run_in_threadpool(consume, service, event)
    except ProviderError:
        raise HTTPException(503, "WAHA contact identity is unavailable.") from None
    return Response(status_code=204)


def deliver():
    service = waha.settings()
    if not enabled() or not service:
        return
    with connect() as conn:
        lost = conn.execute(
            """UPDATE assistant_messages SET status='review',review_reason='Delivery outcome unknown',
                       updated_at=now() WHERE channel='whatsapp' AND status='sending' AND updated_at<now()-interval '3 minutes'
               RETURNING id,farmer_id""",
        ).fetchall()
        for row in lost:
            audit(conn, "delivery_outcome_unknown", row["farmer_id"], row["id"])
        conn.execute(
            """UPDATE assistant_messages m SET status='cancelled',updated_at=now()
               WHERE channel='whatsapp' AND status='queued' AND (
                  (field_id IS NOT NULL AND NOT EXISTS (
                      SELECT 1 FROM fields f WHERE f.id=m.field_id AND f.farmer_id=m.farmer_id AND archived_at IS NULL
                  )) OR NOT EXISTS (
                      SELECT 1 FROM assistant_identities i JOIN farmers p ON p.id=i.farmer_id
                      WHERE i.farmer_id=m.farmer_id AND i.whatsapp_phone=aquaproof_whatsapp_phone(p.phone)
                        AND i.whatsapp_phone=m.recipient_phone
                        AND (m.kind='verify' OR i.whatsapp_verified_at IS NOT NULL)
                  )
               )""",
        )
        row = conn.execute(
            """SELECT m.* FROM assistant_messages m JOIN assistant_identities i USING(farmer_id)
               JOIN farmers p ON p.id=i.farmer_id
               WHERE m.channel='whatsapp' AND m.status='queued' AND m.delivery_after<=now() AND m.direction='outbound' AND i.whatsapp_phone=aquaproof_whatsapp_phone(p.phone)
                        AND i.whatsapp_phone=m.recipient_phone
                 AND (m.kind='verify' OR i.whatsapp_verified_at IS NOT NULL)
               ORDER BY m.created_at LIMIT 1 FOR UPDATE OF m SKIP LOCKED""",
        ).fetchone()
        if not row:
            return
        try:
            if service.state()[0] != "WORKING":
                return
        except ProviderError:
            return
        message_id, farmer_id = row["id"], row["farmer_id"]
        if not delivery_evidence_is_current(row["evidence"]):
            conn.execute(
                """UPDATE assistant_messages SET status='review',review_reason='Weather evidence expired',
                          updated_at=now() WHERE id=%s""", (message_id,),
            )
            audit(conn, "evidence_expired", farmer_id, message_id)
            return
        conn.execute(
            """UPDATE assistant_messages SET status='sending',updated_at=now(),
                      delivery_attempt=delivery_attempt+1 WHERE id=%s""",
            (message_id,),
        )
    with connect() as conn:
        recipient = conn.execute(
            """SELECT 1 FROM farmers p JOIN assistant_identities i ON i.farmer_id=p.id
               WHERE p.id=%s AND i.whatsapp_phone=%s AND i.whatsapp_phone=aquaproof_whatsapp_phone(p.phone)
                 AND (%s='verify' OR i.whatsapp_verified_at IS NOT NULL) FOR SHARE OF p,i""",
            (farmer_id, row["recipient_phone"], row["kind"]),
        ).fetchone()
        field_available = not row["field_id"] or (recipient and conn.execute(
            "SELECT 1 FROM fields WHERE id=%s AND farmer_id=%s AND archived_at IS NULL FOR SHARE",
            (row["field_id"], farmer_id),
        ).fetchone())
        if not recipient or not field_available:
            cancelled = conn.execute(
                """UPDATE assistant_messages SET status='cancelled',updated_at=now()
                   WHERE id=%s AND status='sending' RETURNING id""",
                (message_id,),
            ).fetchone()
            if cancelled:
                audit(conn, "delivery_cancelled", farmer_id, message_id)
            return
        provider_id = None
        try:
            provider_id = service.send(row["recipient_phone"], row["body"])
        except waha.RetryBeforeSend as error:
            status = "queued" if row["delivery_attempt"] < 2 else "failed"
            reason = str(error)
        except ProviderError as error:
            # A POST that reached the provider may have been accepted even when its response was lost.
            status = "failed" if error.status in (400, 401, 403, 404, 422) else "review"
            reason = str(error) if status == "failed" else f"Delivery outcome unknown: {error}"
        else:
            status, reason = "sent", None
        conn.execute(
            """UPDATE assistant_messages SET status=%s,review_reason=%s,provider_message_id=%s,
                     whatsapp_transport=CASE WHEN %s='sent' THEN 'waha' ELSE whatsapp_transport END,updated_at=now(),
                     delivered_at=CASE WHEN %s='sent' THEN now() ELSE delivered_at END,
                     delivery_after=CASE WHEN %s='queued' THEN now()+delivery_attempt*interval '2 minutes' ELSE delivery_after END
               WHERE id=%s AND status='sending'""", (status, reason, provider_id, status, status, status, message_id),
        )
        audit(conn, "delivery_" + status, farmer_id, message_id)
