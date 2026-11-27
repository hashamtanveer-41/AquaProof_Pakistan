from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import Field

from . import waha
from .assistant_access import enabled, queue_field_recheck, verified
from .assistant_farms import delivery_evidence_is_current
from .assistant_jobs import audit, enroll, queue_message
from .assistant_model import LANGUAGE, Observation, config
from .assistant_whatsapp import sync_conversation, worker_enabled
from .database import connect
from .registry import Input, field_by_id
from .service_http import ProviderError


def require_enabled():
    if not enabled():
        raise HTTPException(404, "The agricultural assistant is disabled.")


router = APIRouter(prefix="/api/assistant", tags=["agricultural assistant"])


@router.get("/status")
def status():
    configured = bool(waha.settings())
    return {
        "enabled": enabled(),
        "model_configured": bool(config()),
        "whatsapp_configured": configured,
        "whatsapp_worker_enabled": configured and worker_enabled(),
    }


def configured_waha():
    service = waha.settings()
    if not service:
        raise HTTPException(503, "WAHA is not configured for this workspace.")
    return service


@router.get("/waha/session")
def waha_session():
    service = waha.settings()
    if not service:
        return {"configured": False, "state": None, "phone": None}
    try:
        info, _ = service.session_info()
    except ProviderError as error:
        if error.status == 404:
            info = {"state": "STOPPED", "phone": None}
        else:
            raise HTTPException(502, str(error)) from None
    return {"configured": True, **info}


@router.post("/waha/pair", status_code=204)
def pair_sending_phone():
    try:
        configured_waha().start_pairing()
    except ProviderError as error:
        raise HTTPException(502, str(error)) from None
    return Response(status_code=204)


@router.get("/waha/qr")
def waha_qr():
    try:
        image = configured_waha().pairing_qr()
    except ProviderError as error:
        status = 409 if error.status in (404, 409, 422) else 502
        raise HTTPException(status, "WAHA pairing QR is unavailable. Check the sending phone status.") from None
    return Response(image, media_type="image/png", headers={"Cross-Origin-Resource-Policy": "same-origin"})


class UnlinkConfirmation(Input):
    confirmation: Literal["UNLINK"]


@router.post("/waha/unlink", status_code=204)
def unlink_sending_phone(payload: UnlinkConfirmation):
    try:
        configured_waha().unlink()
    except ProviderError as error:
        raise HTTPException(502, str(error)) from None
    return Response(status_code=204)


class Enrollment(Input):
    language: LANGUAGE | None = None


class Review(Input):
    action: Literal["approve", "reject", "override"]
    note: str = Field(min_length=3, max_length=400)
    replacement: str | None = Field(default=None, min_length=1, max_length=1800)


@router.post("/fields/{field_id}/enroll", status_code=202, dependencies=[Depends(require_enabled)])
def enroll_field(field_id: str, payload: Enrollment):
    if not waha.settings():
        raise HTTPException(503, "Configure WAHA before enrolling a farmer.")
    with connect() as conn:
        farm = field_by_id(conn, field_id)
    return {"status": enroll(farm["farmerId"], payload.language, field_id)}


@router.get("/fields/{field_id}", dependencies=[Depends(require_enabled)])
def monitor(field_id: str):
    with connect() as conn:
        owner = field_by_id(conn, field_id)["farmerId"]
        identity = conn.execute(
            """SELECT i.language,CASE WHEN i.whatsapp_phone=aquaproof_whatsapp_phone(f.phone)
                       THEN i.whatsapp_verified_at END AS verified_at
               FROM assistant_identities i JOIN farmers f ON f.id=i.farmer_id
               WHERE i.farmer_id=%s AND i.whatsapp_phone IS NOT NULL""", (owner,),
        ).fetchone()
        messages = conn.execute(
            """SELECT id,field_id,direction,kind,status,body,evidence,usage,review_reason,delivered_at,
                      created_at,whatsapp_transport
               FROM assistant_messages WHERE farmer_id=%s AND channel='whatsapp' AND (field_id=%s OR field_id IS NULL)
               ORDER BY created_at DESC,id DESC LIMIT 50""", (owner, field_id),
        ).fetchall()
        jobs = conn.execute(
            """SELECT id,kind,local_day,status,attempt,error FROM assistant_jobs
               WHERE farmer_id=%s AND channel='whatsapp' AND (field_id=%s OR field_id IS NULL)
               ORDER BY id DESC LIMIT 20""",
            (owner, field_id),
        ).fetchall()
        observations = conn.execute(
            """SELECT id,measurements,status,created_at FROM assistant_observations
               WHERE farmer_id=%s AND field_id=%s ORDER BY id DESC LIMIT 30""", (owner, field_id),
        ).fetchall()
        cost = conn.execute(
            """SELECT count(*) FILTER (WHERE call ? 'cost') AS priced_calls,
                      count(*) AS calls, sum((call->>'cost')::numeric) AS cost_usd
               FROM assistant_messages m CROSS JOIN LATERAL jsonb_array_elements(m.usage->'calls') AS c(call)
               WHERE m.channel='whatsapp' AND m.farmer_id=%s AND (m.field_id=%s OR m.field_id IS NULL)""", (owner, field_id),
        ).fetchone()
    return {"identity": identity, "messages": messages, "jobs": jobs, "observations": observations,
            "usage": cost}


@router.get("/conversations/{farmer_id}")
def conversation(farmer_id: str, before: UUID | None = None, limit: int = Query(default=40, ge=1, le=100)):
    with connect() as conn:
        farmer = conn.execute(
            """SELECT f.id,CASE WHEN i.whatsapp_phone=aquaproof_whatsapp_phone(f.phone)
                          THEN i.whatsapp_verified_at END AS verified_at
               FROM farmers f LEFT JOIN assistant_identities i ON i.farmer_id=f.id WHERE f.id=%s""",
            (farmer_id,),
        ).fetchone()
        if not farmer:
            raise HTTPException(404, "Farmer not found.")
        cursor = None
        if before:
            cursor = conn.execute(
                """SELECT created_at,id FROM assistant_messages
                   WHERE farmer_id=%s AND channel='whatsapp' AND id=%s""", (farmer_id, before),
            ).fetchone()
            if not cursor:
                raise HTTPException(404, "Conversation page not found.")
        messages = conn.execute(
            """SELECT m.id,m.direction,m.kind,m.status,m.body,m.created_at,m.delivered_at,
                      m.whatsapp_transport,f.name AS field_name
               FROM assistant_messages m LEFT JOIN fields f ON f.id=m.field_id AND f.farmer_id=m.farmer_id
               WHERE m.farmer_id=%s AND m.channel='whatsapp'
                 AND (%s::timestamptz IS NULL OR (m.created_at,m.id)<(%s,%s))
               ORDER BY m.created_at DESC,m.id DESC LIMIT %s""",
            (farmer_id, cursor and cursor["created_at"], cursor and cursor["created_at"], before, limit + 1),
        ).fetchall()
    return {"verified_at": farmer["verified_at"], "messages": messages[:limit],
            "next_cursor": messages[limit - 1]["id"] if len(messages) > limit else None}


@router.post("/conversations/{farmer_id}/refresh")
def refresh_conversation(farmer_id: str):
    try:
        state = sync_conversation(farmer_id)
    except ProviderError as error:
        raise HTTPException(502, str(error)) from None
    return {"status": state}


@router.post("/fields/{field_id}/messages/{message_id}/review", dependencies=[Depends(require_enabled)])
def review_message(field_id: str, message_id: UUID, review: Review):
    note = review.note.strip()
    if not note:
        raise HTTPException(422, "Enter an officer review note.")
    with connect() as conn:
        owner = field_by_id(conn, field_id)["farmerId"]
        row = conn.execute(
            """SELECT * FROM assistant_messages WHERE id=%s AND farmer_id=%s AND (field_id=%s OR field_id IS NULL)
               AND channel='whatsapp' AND status IN ('review','failed') AND direction='outbound' FOR UPDATE""",
            (message_id, owner, field_id),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Reviewable message not found.")
        if review.action == "approve":
            if not verified(conn, owner) and row["kind"] != "verify":
                raise HTTPException(409, "Verify the farmer before sending.")
            if not delivery_evidence_is_current(row["evidence"]):
                raise HTTPException(409, "Evidence expired. Request a fresh calculation or write an officer override.")
            if (row["review_reason"] or "").startswith("Delivery outcome"):
                raise HTTPException(409, "Confirm delivery outcome first. Use an explicit override when safe.")
            conn.execute("""UPDATE assistant_messages SET status='queued',updated_at=now(),
                         delivery_after=now(),delivery_attempt=0 WHERE id=%s""",
                         (message_id,))
        else:
            if review.action == "override":
                if not review.replacement or not review.replacement.strip() or not verified(conn, owner):
                    raise HTTPException(422, "An override requires message text and a verified farmer.")
                queue_message(conn, owner, kind="manual", body=review.replacement.strip(),
                              field_id=row["field_id"], dedupe="override:" + str(uuid4()),
                              evidence={"review_message": str(message_id), "override_note": note})
            conn.execute("UPDATE assistant_messages SET status='rejected',updated_at=now() WHERE id=%s",
                         (message_id,))
        audit(conn, "officer_" + review.action, owner, message_id, note=note)
    return {"status": "Review saved"}


class ManualMessage(Input):
    body: str = Field(min_length=1, max_length=1800)
    request_id: UUID


@router.post("/fields/{field_id}/messages", status_code=202, dependencies=[Depends(require_enabled)])
def send_manual(field_id: str, payload: ManualMessage):
    if not waha.settings():
        raise HTTPException(503, "Configure WAHA before sending a message.")
    body = payload.body.strip()
    if not body:
        raise HTTPException(422, "Enter a message.")
    with connect() as conn:
        owner = field_by_id(conn, field_id)["farmerId"]
        if not verified(conn, owner, lock=True):
            raise HTTPException(409, "Verify the farmer's WhatsApp number first.")
        queue_message(conn, owner, kind="manual", body=body, field_id=field_id,
                      dedupe=f"manual:wa:{owner}:{payload.request_id}")
    return {"status": "WhatsApp message queued."}


class ObservationReview(Input):
    action: Literal["approved", "rejected"]
    note: str = Field(min_length=3, max_length=400)


@router.post("/fields/{field_id}/observations/{observation_id}/review", dependencies=[Depends(require_enabled)])
def review_observation(field_id: str, observation_id: int, review: ObservationReview):
    with connect() as conn:
        owner = field_by_id(conn, field_id)["farmerId"]
        row = conn.execute(
            """SELECT measurements,inbound_id FROM assistant_observations
               WHERE id=%s AND field_id=%s AND farmer_id=%s AND status='review' FOR UPDATE""",
            (observation_id, field_id, owner),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Reviewable observation not found.")
        if review.action == "approved":
            Observation.model_validate(row["measurements"])
        conn.execute("UPDATE assistant_observations SET status=%s,reviewed_at=now() WHERE id=%s",
                     (review.action, observation_id))
        audit(conn, "observation_" + review.action, owner, row["inbound_id"], note=review.note.strip())
        if review.action == "approved":
            queue_field_recheck(conn, field_id)
    return {"status": "Observation review saved"}
