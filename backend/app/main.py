"""Application entry point for the AquaProof API."""

import os
from contextlib import asynccontextmanager

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from psycopg import OperationalError

from .communications import deliver_due, import_replies, parse_pending, router as communications_router
from .registry import router as registry_router
from .maps import router as map_router
from .science.routes import locations, router as science_router
from .assistant_access import enabled as assistant_enabled, officer_authorized
from .assistant_api import router as assistant_router
from .assistant_jobs import process_one, schedule
from .assistant_mail import deliver as assistant_delivery, poll as assistant_poll


@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler = BackgroundScheduler(timezone="Asia/Karachi")
    scheduler.add_job(deliver_due, "interval", seconds=5, max_instances=1)
    if assistant_enabled():
        scheduler.add_job(schedule, "interval", seconds=60, max_instances=1)
        for index in range(3):
            scheduler.add_job(process_one, "interval", seconds=8, max_instances=1, id=f"assistant-worker-{index}")
        scheduler.add_job(assistant_delivery, "interval", seconds=5, max_instances=1)
        scheduler.add_job(assistant_poll, "interval", seconds=45, max_instances=1)
    else:
        scheduler.add_job(parse_pending, "interval", seconds=10, max_instances=1)
        scheduler.add_job(import_replies, "interval", seconds=60, max_instances=1)
    scheduler.start()
    try:
        yield
    finally:
        scheduler.shutdown(wait=False)


app = FastAPI(title="AquaProof Pakistan API", lifespan=lifespan)
app.include_router(registry_router)
app.include_router(map_router)
app.include_router(communications_router)
app.include_router(science_router)
app.include_router(locations)
app.include_router(assistant_router)


@app.middleware("http")
async def prevent_cached_api_responses(request: Request, call_next):
    path = request.url.path
    if (assistant_enabled() and path.startswith("/api/") and request.method != "OPTIONS"
            and path not in ("/api/assistant/status", "/api/map/config")
            and not officer_authorized(request.headers.get("Authorization"))):
        return JSONResponse(
            {"detail": "Officer sign-in required."}, status_code=401,
            headers={"Cache-Control": "no-store", "WWW-Authenticate": "Bearer"},
        )
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.exception_handler(OperationalError)
async def database_unavailable(request: Request, error: OperationalError):
    return JSONResponse({"detail": "The registry database is unavailable."}, status_code=503)

origins = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", tags=["health"])
def health() -> dict[str, str]:
    return {"status": "ok"}
