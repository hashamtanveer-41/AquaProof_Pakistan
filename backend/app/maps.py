import os

from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/map", tags=["map"])


def tracing_authorized():
    return os.getenv("MAPTILER_TRACING_AUTHORIZED", "").strip().lower() in {"1", "true"}


def require_tracing_authorization():
    if not tracing_authorized():
        raise HTTPException(403, "Boundary tracing is disabled until imagery digitization and storage are authorized.")


@router.get("/config")
def map_config():
    return {
        "api_key": os.getenv("MAPTILER_API_KEY", "").strip(),
        "tracing_authorized": tracing_authorized(),
    }
