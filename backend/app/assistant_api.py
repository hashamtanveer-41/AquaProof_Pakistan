import os
from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field

from . import green_api
from .assistant_access import enabled, queue_field_recheck, verified
from .assistant_farms import delivery_evidence_is_current
from .assistant_jobs import audit, enroll, queue_message
from .assistant_model import LANGUAGE, Observation, config
from .database import connect
from .registry import Input, field_by_id


def require_enabled():
    if not enabled():
        raise HTTPException(404, "The agricultural assistant is disabled.")


router = APIRouter(prefix="/api/assistant", tags=["agricultural assistant"])


@router.get("/status")
def status():
    return {
        "enabled": enabled(),
        "model_configured": bool(config()),
        "whatsapp_configured": bool(green_api.settings()),
        "whatsapp_worker_enabled": enabled() and os.getenv("AQUAPROOF_BACKGROUND_WHATSAPP", "0") == "1",
    }


class Enrollment(Input):
    language: LANGUAGE | None = None


class Review(Input):
    action: Literal["approve", "reject", "override"]
    note: str = Field(min_length=3, max_length=400)
    replacement: str | None = Field(default=None, min_length=1, max_length=1800)


@router.post("/fields/{field_id}/enroll", status_code=202, dependencies=[Depends(require_enabled)])
def enroll_field(field_id: str, payload: Enrollment):
    if not green_api.settings():
        raise HTTPException(503, "Configure Green API before enrolling a farmer.")
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
            """SELECT id,field_id,direction,kind,status,body,evidence,usage,review_reason,delivered_at,created_at
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
    if not green_api.settings():
        raise HTTPException(503, "Configure Green API before sending a message.")
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
