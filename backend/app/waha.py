"""WAHA transport for direct WhatsApp text messages."""

import hashlib
import hmac
import logging
import os
import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from urllib.parse import quote, urlsplit

import httpx

from .service_http import ProviderError

logging.getLogger("httpx").setLevel(logging.WARNING)
DIRECT_CHAT = re.compile(r"([1-9][0-9]{7,14})@(?:c\.us|s\.whatsapp\.net)")
LINKED_CHAT = re.compile(r"[0-9]{1,24}@lid")
SERIALIZED_ID = re.compile(r"(?:true|false)_[^_]+_(.+)")


class RetryBeforeSend(ProviderError):
    pass


def message_key(value):
    if not isinstance(value, str) or not 1 <= len(value) <= 240:
        return None
    # Engines can serialize a quote with a different chat alias or direction prefix.
    match = SERIALIZED_ID.fullmatch(value)
    return match[1] if match else value


@dataclass(frozen=True, repr=False)
class WAHA:
    origin: str
    session: str
    api_key: str
    webhook_secret: str

    def request(self, method, path, *, operation, payload=None, params=None, response_type=dict,
                accept="application/json"):
        try:
            response = httpx.request(
                method, self.origin + path, json=payload, params=params,
                headers={"X-Api-Key": self.api_key, "Accept": accept},
                timeout=httpx.Timeout(20, connect=4),
            )
        except (httpx.ConnectError, httpx.ConnectTimeout, httpx.PoolTimeout):
            raise RetryBeforeSend("WAHA connection unavailable") from None
        except httpx.RequestError:
            raise ProviderError(f"WAHA {operation} timed out or connection was interrupted") from None
        if not response.is_success:
            error_type = RetryBeforeSend if response.status_code == 429 else ProviderError
            raise error_type(f"WAHA {operation} HTTP {response.status_code}", response.status_code)
        if response_type is None:
            return response, response.status_code
        try:
            data = response.json()
        except ValueError:
            raise ProviderError(f"WAHA {operation} returned invalid JSON") from None
        if not isinstance(data, response_type):
            raise ProviderError(f"WAHA {operation} returned an invalid response")
        return data, response.status_code

    def session_info(self):
        data, code = self.request("GET", f"/api/sessions/{self.session}", operation="session")
        state = data.get("status")
        if state not in ("WORKING", "STOPPED", "STARTING", "SCAN_QR_CODE", "FAILED",
                         "PASSKEY_REQUIRED", "PASSKEY_CONFIRMATION_REQUIRED"):
            raise ProviderError("Unexpected WAHA session status", code)
        me = data.get("me")
        jid = me.get("id") if isinstance(me, dict) else None
        match = DIRECT_CHAT.fullmatch(jid) if isinstance(jid, str) else None
        return {"state": state, "phone": match[1] if match and state == "WORKING" else None}, code

    def state(self):
        details, code = self.session_info()
        return details["state"], code

    def start_pairing(self):
        try:
            state, _ = self.state()
        except ProviderError as error:
            if error.status != 404:
                raise
            self.request("POST", "/api/sessions", operation="create session", response_type=None,
                         payload={"name": self.session, "start": True})
            return
        if state in ("STOPPED", "FAILED"):
            action = "restart" if state == "FAILED" else "start"
            self.request("POST", f"/api/sessions/{self.session}/{action}", operation=action, response_type=None)

    def pairing_qr(self):
        response, _ = self.request("GET", f"/api/{self.session}/auth/qr",
                                   operation="pairing QR", response_type=None, accept="image/png")
        png = response.content
        if not png.startswith(b"\x89PNG\r\n\x1a\n") or len(png) > 512 * 1024:
            raise ProviderError("WAHA did not return a valid pairing image")
        return png

    def unlink(self):
        self.request("POST", f"/api/sessions/{self.session}/logout", operation="unlink session",
                     response_type=None)

    def send(self, phone, body):
        chat = f"{phone}@c.us"
        if not DIRECT_CHAT.fullmatch(chat):
            raise ProviderError("WAHA requires a direct phone recipient", 422)
        data, _ = self.request("POST", "/api/sendText", operation="sendText", payload={
            "session": self.session, "chatId": chat, "text": body, "linkPreview": False,
        })
        if not (key := message_key(data.get("id"))):
            raise ProviderError("WAHA delivery outcome unknown: missing message ID")
        return key

    def recent_inbound(self, phone, since):
        chat = quote(f"{phone}@c.us", safe="")
        rows, _ = self.request("GET", f"/api/{self.session}/chats/{chat}/messages",
                               operation="recent messages", response_type=list, params={
                                   "limit": 50, "downloadMedia": "false", "filter.fromMe": "false",
                                   "filter.timestamp.gte": int(since.timestamp()),
                               })
        return [row for row in rows if isinstance(row, dict) and (
            instant := received_time(row.get("timestamp"))
        ) and instant.timestamp() >= int(since.timestamp())]

    def sender_phone(self, sender):
        match = DIRECT_CHAT.fullmatch(sender)
        if match:
            return match[1]
        if not LINKED_CHAT.fullmatch(sender):
            return None
        data, _ = self.request(
            "GET", f"/api/{self.session}/lids/{quote(sender, safe='')}", operation="contact identity",
        )
        phone = data.get("pn")
        match = DIRECT_CHAT.fullmatch(phone) if data.get("lid") == sender and isinstance(phone, str) else None
        return match[1] if match else None

    def authenticated(self, body, algorithm, signature):
        if algorithm != "sha512" or not re.fullmatch(r"[0-9a-fA-F]{128}", signature):
            return False
        expected = hmac.new(self.webhook_secret.encode(), body, hashlib.sha512).hexdigest()
        return hmac.compare_digest(expected, signature.lower())

    def incoming_text(self, event):
        if not isinstance(event, dict) or event.get("event") != "message" or event.get("session") != self.session:
            return None
        payload = event.get("payload")
        if not isinstance(payload, dict) or payload.get("fromMe") is not False or payload.get("hasMedia") is True:
            return None
        sender, key, body = payload.get("from"), message_key(payload.get("id")), payload.get("body")
        if not isinstance(sender, str) or not key or not isinstance(body, str) or not body.strip() or len(body) > 8192:
            return None
        if not (phone := self.incoming_phone(payload, sender)):
            return None
        reply = payload.get("replyTo")
        reply = reply if isinstance(reply, dict) else {}
        quoted = reply.get("body")
        return phone, key, body, quoted if isinstance(quoted, str) else None, message_key(reply.get("id"))

    def incoming_phone(self, payload, sender):
        raw = payload.get("_data")
        info = raw.get("Info") if isinstance(raw, dict) else None
        if (LINKED_CHAT.fullmatch(sender) and isinstance(info, dict)
                and info.get("Chat") == sender and info.get("Sender") == sender):
            alternate = info.get("SenderAlt")
            if isinstance(alternate, str) and (match := DIRECT_CHAT.fullmatch(alternate)):
                return match[1]
        return self.sender_phone(sender)


def received_time(timestamp):
    now = datetime.now(UTC)
    if type(timestamp) not in (int, float) or not (
        (now - timedelta(days=7)).timestamp() <= timestamp <= (now + timedelta(minutes=5)).timestamp()
    ):
        return None
    return datetime.fromtimestamp(timestamp, UTC)


def settings():
    api_key = os.getenv("WAHA_API_KEY", "").strip()
    secret = os.getenv("WAHA_WEBHOOK_SECRET", "").strip()
    session = os.getenv("WAHA_SESSION", "default").strip()
    try:
        url = urlsplit(os.getenv("WAHA_BASE_URL", "").strip())
        port = url.port
    except ValueError:
        return None
    if (not api_key or len(secret) < 32 or secret in (api_key, os.getenv("ASSISTANT_REPLY_SECRET", ""))
            or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", session)
            or not url.hostname or url.username is not None or url.password is not None
            or url.path not in ("", "/") or url.query or url.fragment or port == 0
            or not (url.scheme == "https" or (
                url.scheme == "http" and url.hostname in ("localhost", "127.0.0.1", "::1", "waha")
            ))):
        return None
    return WAHA(f"{url.scheme}://{url.netloc}", session, api_key, secret)
