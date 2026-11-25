"""Green API WhatsApp HTTP transport. Provider URLs contain a secret path segment."""

import logging
import os
import re
from dataclasses import dataclass
from urllib.parse import urlsplit

import httpx

from .service_http import ProviderError, request_json

logging.getLogger("httpx").setLevel(logging.WARNING)
DIRECT_CHAT = re.compile(r"([1-9][0-9]{7,14})@c\.us")
PROVIDER_HOST = re.compile(r"(?:[0-9]+\.)?api\.green-?api\.com")


@dataclass(frozen=True, repr=False)
class GreenAPI:
    origin: str
    instance: str
    token: str

    def endpoint(self, operation):
        return f"{self.origin}/waInstance{self.instance}/{operation}/{self.token}"

    def state(self):
        data, response = request_json("GET", self.endpoint("getStateInstance"), service="green_api_state")
        state = data.get("stateInstance")
        if state not in ("authorized", "notAuthorized", "blocked", "sleepMode", "starting", "yellowCard"):
            raise ProviderError("Unexpected Green API instance state", response.status_code)
        return state, response.status_code

    def polling_issue(self):
        data, response = request_json("GET", self.endpoint("getSettings"), service="green_api_settings")
        incoming = data.get("incomingWebhook")
        if incoming not in ("yes", "no"):
            raise ProviderError("Missing Green API incomingWebhook setting", response.status_code)
        if data.get("webhookUrl"):
            return "The instance uses a webhook URL. Use a dedicated instance with HTTP polling."
        if incoming == "no":
            return "Enable incomingWebhook in the Green API instance settings"
        return None

    def send(self, phone, body):
        data = self.request("POST", "sendMessage", payload={"chatId": phone + "@c.us", "message": body})
        message_id = data.get("idMessage") if isinstance(data, dict) else None
        if not isinstance(message_id, str) or not 1 <= len(message_id) <= 240:
            raise ProviderError("Green API delivery outcome unknown: missing message ID")
        return message_id

    def request(self, method, operation, *, receipt=None, payload=None):
        url = self.endpoint(operation)
        if receipt is not None:
            url += "/" + str(receipt)
        try:
            response = httpx.request(method, url, json=payload, timeout=httpx.Timeout(25, connect=4))
        except (httpx.ConnectError, httpx.ConnectTimeout, httpx.PoolTimeout):
            raise RetryBeforeSend("Green API connection unavailable") from None
        except httpx.RequestError:
            raise ProviderError(f"Green API {operation} timed out or connection was interrupted") from None
        if response.status_code != 200:
            error_type = RetryBeforeSend if response.status_code == 429 else ProviderError
            raise error_type(f"Green API {operation} HTTP {response.status_code}", response.status_code)
        try:
            return response.json()
        except ValueError:
            raise ProviderError(f"Green API {operation} returned invalid JSON") from None

    def receive(self, consume):
        # Acknowledge only after processing commits. A repeated provider message ID is deduplicated in PostgreSQL.
        for _ in range(10):
            notice = self.request("GET", "receiveNotification")
            if notice is None:
                return
            receipt = notice.get("receiptId") if isinstance(notice, dict) else None
            if type(receipt) is not int or receipt < 0 or not isinstance(notice.get("body"), dict):
                raise ProviderError("Green API receiveNotification returned an invalid notification")
            if message := incoming_text(notice["body"], self.instance):
                consume(*message)
            result = self.request("DELETE", "deleteNotification", receipt=receipt)
            if not isinstance(result, dict) or result.get("result") is not True:
                raise ProviderError("Green API did not confirm notification deletion")


class RetryBeforeSend(ProviderError):
    pass


def settings():
    instance = os.getenv("GREEN_API_ID_INSTANCE", "").strip()
    token = os.getenv("GREEN_API_TOKEN_INSTANCE", "").strip()
    try:
        url = urlsplit(os.getenv("GREEN_API_BASE_URL", "https://api.green-api.com").strip())
    except ValueError:
        return None
    if (not re.fullmatch(r"[0-9]{8,16}", instance) or not re.fullmatch(r"[A-Za-z0-9_-]{32,128}", token)
            or url.scheme != "https" or not PROVIDER_HOST.fullmatch(url.netloc)
            or url.path not in ("", "/") or url.query or url.fragment):
        return None
    return GreenAPI(f"https://{url.netloc}", instance, token)


def object_at(value, key):
    item = value.get(key)
    return item if isinstance(item, dict) else {}


def incoming_text(body, instance):
    if body.get("typeWebhook") != "incomingMessageReceived":
        return None
    if str(object_at(body, "instanceData").get("idInstance")) != instance:
        return None
    sender = object_at(body, "senderData")
    chat = sender.get("chatId")
    match = DIRECT_CHAT.fullmatch(chat) if isinstance(chat, str) else None
    message_id = body.get("idMessage")
    if (not match or chat != sender.get("sender") or not isinstance(message_id, str)
            or not 1 <= len(message_id) <= 240):
        return None
    data = object_at(body, "messageData")
    kind = data.get("typeMessage")
    quote = None
    reply_to = None
    if kind == "textMessage":
        message = object_at(data, "textMessageData").get("textMessage")
    elif kind in ("extendedTextMessage", "quotedMessage"):
        extended = object_at(data, "extendedTextMessageData")
        message = extended.get("text")
        quoted = object_at(data, "quotedMessage")
        quote = quoted.get("textMessage") or quoted.get("text")
        reply_to = quoted.get("stanzaId") or extended.get("stanzaId")
    else:
        return None
    if not isinstance(message, str) or not message.strip() or len(message) > 8192:
        return None
    return (
        match[1], message_id, message, quote if isinstance(quote, str) else None,
        reply_to if isinstance(reply_to, str) and 1 <= len(reply_to) <= 240 else None,
    )
