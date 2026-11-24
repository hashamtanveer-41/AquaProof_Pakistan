import hmac
import os
from contextlib import contextmanager
from uuid import uuid4

from fastapi import HTTPException

from .database import connect


def enabled():
    return os.getenv("ASSISTANT_ENABLED", "0") == "1"


def officer_authorized(authorization):
    secret = os.getenv("ASSISTANT_OFFICER_TOKEN", "")
    scheme, _, supplied = (authorization or "").partition(" ")
    return len(secret) >= 32 and scheme.lower() == "bearer" and hmac.compare_digest(
        secret.encode(), supplied.encode(),
    )


def verified(connection, farmer_id):
    return connection.execute(
        """SELECT i.farmer_id,i.email,i.language FROM assistant_identities i
           JOIN farmers f ON f.id=i.farmer_id
           WHERE i.farmer_id=%s AND i.verified_at IS NOT NULL AND lower(f.email)=i.email""",
        (farmer_id,),
    ).fetchone()


def queue_field_recheck(connection, field_id):
    if not enabled():
        return
    connection.execute(
        """INSERT INTO assistant_jobs(farmer_id,field_id,kind,local_day,dedupe)
           SELECT j.farmer_id,j.field_id,'correction',j.local_day,%s
           FROM assistant_jobs j JOIN fields f ON f.id=j.field_id AND f.farmer_id=j.farmer_id
           WHERE j.field_id=%s AND j.local_day=(now() AT TIME ZONE 'Asia/Karachi')::date
             AND j.kind='daily' AND j.status='done' AND f.archived_at IS NULL
           ON CONFLICT(dedupe) DO NOTHING""",
        ("field-change:" + str(uuid4()), field_id),
    )


@contextmanager
def farmer_scope(farmer_id):
    with connect() as connection:
        if not verified(connection, farmer_id):
            raise HTTPException(403, "Farmer enrollment is unverified or revoked.")
        connection.execute("SELECT set_config('aquaproof.farmer', %s, true)", (farmer_id,))
        connection.execute("SET LOCAL ROLE aquaproof_assistant_reader")
        yield connection
