import imaplib
import logging
import os
import smtplib
import ssl
from email import policy
from email.message import EmailMessage
from email.parser import BytesParser
from email.utils import parseaddr

from .assistant_access import enabled
from .assistant_farms import fresh
from .assistant_jobs import accept_message, audit, signed_token
from .database import connect
from .science.crops import local_today
from datetime import timedelta

log = logging.getLogger(__name__)


class RetryBeforeSend(OSError):
    pass


class EmailTransport:
    def send(self, recipient, subject, body, message_id):
        message = EmailMessage()
        message["From"] = os.getenv("SMTP_FROM", "advisory@aquaproof.local")
        message["To"] = recipient
        message["Subject"] = subject
        message["Message-ID"] = message_id
        message.set_content(body)
        smtp = None
        try:
            smtp = smtplib.SMTP(os.environ["SMTP_HOST"], int(os.getenv("SMTP_PORT", "1025")), timeout=12)
            if os.getenv("SMTP_STARTTLS") == "1":
                smtp.starttls(context=ssl.create_default_context())
            if username := os.getenv("SMTP_USERNAME"):
                smtp.login(username, os.environ["SMTP_PASSWORD"])
        except (OSError, smtplib.SMTPException, KeyError, ValueError):
            if smtp:
                smtp.close()
            raise RetryBeforeSend("SMTP setup failed before transmission") from None
        try:
            smtp.send_message(message)
        finally:
            smtp.close()

    def receive(self, consume):
        if not all(os.getenv(name) for name in ("IMAP_HOST", "IMAP_USERNAME", "IMAP_PASSWORD")):
            return
        with imaplib.IMAP4_SSL(os.environ["IMAP_HOST"], int(os.getenv("IMAP_PORT", "993")),
                              ssl_context=ssl.create_default_context(), timeout=12) as mailbox:
            mailbox.login(os.environ["IMAP_USERNAME"], os.environ["IMAP_PASSWORD"])
            if mailbox.select("INBOX")[0] != "OK":
                return
            status, data = mailbox.uid("search", None, "UNSEEN")
            if status != "OK":
                return
            for uid in data[0].split()[:40]:
                status, parts = mailbox.uid("fetch", uid, "(BODY.PEEK[]<0.65536>)")
                if status != "OK":
                    continue
                raw = next((part[1] for part in parts if isinstance(part, tuple)), None)
                if not raw:
                    continue
                msg = BytesParser(policy=policy.default).parsebytes(raw)
                if str(msg.get("Auto-Submitted", "no")).lower() == "no":
                    sender = parseaddr(str(msg.get("From", "")))[1]
                    body = msg.get_body(preferencelist=("plain",))
                    if sender and body and body.get_content_type() == "text/plain":
                        value = body.get_content()
                        if isinstance(value, str):
                            message_key = str(msg.get("Message-ID") or uid.decode())[:240]
                            consume(sender, message_key, value)
                # Use a dedicated inbox for this transport, so unsupported mail cannot block the queue.
                mailbox.uid("store", uid, "+FLAGS", "(\\Seen)")


transport = EmailTransport()


def poll():
    if enabled():
        try:
            transport.receive(accept_message)
        except (OSError, imaplib.IMAP4.error) as error:
            log.warning("Assistant inbox unavailable: %s", type(error).__name__)


def deliver():
    if not enabled() or not os.getenv("SMTP_HOST"):
        return
    with connect() as conn:
        lost = conn.execute(
            """UPDATE assistant_messages SET status='review',review_reason='Delivery outcome unknown',
                       updated_at=now() WHERE status='sending' AND updated_at<now()-interval '3 minutes'
               RETURNING id,farmer_id""",
        ).fetchall()
        for row in lost:
            audit(conn, "delivery_outcome_unknown", row["farmer_id"], row["id"])
        conn.execute(
            """UPDATE assistant_messages m SET status='cancelled',updated_at=now()
               WHERE status='queued' AND (
                  (field_id IS NOT NULL AND NOT EXISTS (
                      SELECT 1 FROM fields f WHERE f.id=m.field_id AND f.farmer_id=m.farmer_id AND archived_at IS NULL
                  )) OR NOT EXISTS (
                      SELECT 1 FROM assistant_identities i JOIN farmers p ON p.id=i.farmer_id
                      WHERE i.farmer_id=m.farmer_id AND i.email=lower(p.email)
                        AND (m.kind='verify' OR i.verified_at IS NOT NULL)
                  )
               )""",
        )
        row = conn.execute(
            """SELECT m.*,i.email FROM assistant_messages m JOIN assistant_identities i USING(farmer_id)
               JOIN farmers p ON p.id=i.farmer_id
               WHERE m.status='queued' AND m.delivery_after<=now() AND m.direction='outbound' AND i.email=lower(p.email)
                 AND (m.kind='verify' OR i.verified_at IS NOT NULL)
               ORDER BY m.created_at LIMIT 1 FOR UPDATE OF m SKIP LOCKED""",
        ).fetchone()
        if not row:
            return
        message_id, farmer_id = row["id"], row["farmer_id"]
        data = row["evidence"].get("forecast")
        recommendation_day = row["evidence"].get("today", {}).get("date")
        if data and (not fresh(data, "retrieved_at", timedelta(hours=2))
                     or (recommendation_day and recommendation_day != local_today().isoformat())):
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
            """UPDATE assistant_messages SET status='sending',recipient_email=%s,updated_at=now(),
                      delivery_attempt=delivery_attempt+1 WHERE id=%s""",
            (row["email"], message_id),
        )
    try:
        transport.send(row["email"], "AquaProof Pakistan",
                       f"{row['body']}\n\nAQ-REPLY {token}",
                       f"<assistant-{message_id}@aquaproof.local>")
    except RetryBeforeSend:
        status = "queued" if row["delivery_attempt"] < 2 else "failed"
        reason = "SMTP setup failed before transmission"
    except (OSError, smtplib.SMTPException, ValueError) as error:
        # An SMTP failure can occur after the remote server accepted delivery. Review rather than retry blindly.
        status, reason = ("failed" if isinstance(error, smtplib.SMTPRecipientsRefused) else "review",
                          "SMTP delivery failed or outcome unknown")
    else:
        status, reason = "sent", None
    with connect() as conn:
        conn.execute(
            """UPDATE assistant_messages SET status=%s,review_reason=%s,updated_at=now(),
                     delivered_at=CASE WHEN %s='sent' THEN now() ELSE delivered_at END,
                     delivery_after=CASE WHEN %s='queued' THEN now()+delivery_attempt*interval '2 minutes' ELSE delivery_after END
               WHERE id=%s AND status='sending'""", (status, reason, status, status, message_id),
        )
        audit(conn, "delivery_" + status, farmer_id, message_id)
