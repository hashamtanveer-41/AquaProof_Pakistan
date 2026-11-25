import logging

from . import green_api
from .assistant_access import enabled
from .assistant_farms import delivery_evidence_is_current
from .assistant_jobs import accept_message, audit, signed_token
from .database import connect
from .service_http import ProviderError

log = logging.getLogger(__name__)


def poll():
    service = green_api.settings()
    if not enabled() or not service:
        return
    try:
        with connect() as conn:
            lock = conn.execute("SELECT pg_try_advisory_xact_lock(89133702) AS acquired").fetchone()
            if lock["acquired"]:
                service.receive(accept_message)
    except ProviderError as error:
        log.warning("%s", error)


def deliver():
    service = green_api.settings()
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
        message_id, farmer_id = row["id"], row["farmer_id"]
        if not delivery_evidence_is_current(row["evidence"]):
            conn.execute(
                """UPDATE assistant_messages SET status='review',review_reason='Weather evidence expired',
                          updated_at=now() WHERE id=%s""", (message_id,),
            )
            audit(conn, "evidence_expired", farmer_id, message_id)
            return
        try:
            token = signed_token(message_id)
        except RuntimeError:
            conn.execute(
                """UPDATE assistant_messages SET status='failed',review_reason='Reply secret not configured',
                          updated_at=now() WHERE id=%s""", (message_id,),
            )
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
            conn.execute(
                "UPDATE assistant_messages SET status='cancelled',updated_at=now() WHERE id=%s AND status='sending'",
                (message_id,),
            )
            audit(conn, "delivery_cancelled", farmer_id, message_id)
            return
        provider_id = None
        try:
            provider_id = service.send(row["recipient_phone"], f"{row['body']}\n\nAQ-REPLY {token}")
        except green_api.RetryBeforeSend as error:
            status = "queued" if row["delivery_attempt"] < 2 else "failed"
            reason = str(error)
        except ProviderError as error:
            # A POST that reached the provider may have been accepted even when its response was lost.
            status = "failed" if error.status in (400, 401, 403, 404, 422) else "review"
            reason = str(error) if status == "failed" else f"Delivery outcome unknown: {error}"
        else:
            status, reason = "sent", None
        conn.execute(
            """UPDATE assistant_messages SET status=%s,review_reason=%s,provider_message_id=%s,updated_at=now(),
                     delivered_at=CASE WHEN %s='sent' THEN now() ELSE delivered_at END,
                     delivery_after=CASE WHEN %s='queued' THEN now()+delivery_attempt*interval '2 minutes' ELSE delivery_after END
               WHERE id=%s AND status='sending'""", (status, reason, provider_id, status, status, message_id),
        )
        audit(conn, "delivery_" + status, farmer_id, message_id)
