"""Application entry point for the AquaProof API."""

import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from psycopg import OperationalError

from . import officer_auth, waha
from .arcgis import router as map_router
from .assistant_api import router as assistant_router
from .assistant_jobs import process_one, schedule
from .assistant_whatsapp import deliver as assistant_delivery
from .assistant_whatsapp import webhooks, worker_enabled
from .database import connect
from .registry import router as registry_router
from .science.routes import locations
from .science.routes import router as science_router
from .service_health import router as service_router
from .service_health import run_checks


class PrivateApiAccess(logging.Filter):
    def filter(self, record):
        if isinstance(record.args, tuple) and len(record.args) == 5:
            client, method, path, version, status = record.args
            route = path.partition("?")[0] if isinstance(path, str) else ""
            if route == "/api" or route.startswith("/api/"):
                record.args = (client, method, "/api", version, status)
        return True


logging.getLogger("uvicorn.access").addFilter(PrivateApiAccess())


@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler = BackgroundScheduler(timezone="Asia/Karachi")
    if os.getenv("AQUAPROOF_HEALTH_ENABLED", "1") == "1":
        scheduler.add_job(run_checks, "interval", minutes=30, next_run_time=datetime.now().astimezone(), max_instances=1)
    if worker_enabled() and waha.settings():
        scheduler.add_job(schedule, "interval", seconds=60, max_instances=1)
        for index in range(3):
            scheduler.add_job(process_one, "interval", seconds=8, max_instances=1, id=f"assistant-worker-{index}")
        scheduler.add_job(assistant_delivery, "interval", seconds=5, max_instances=1)
    scheduler.start()
    try:
        yield
    finally:
        scheduler.shutdown(wait=False)


app = FastAPI(title="AquaProof Pakistan API", lifespan=lifespan)
app.include_router(registry_router)
app.include_router(science_router)
app.include_router(locations)
app.include_router(assistant_router)
app.include_router(map_router)
app.include_router(service_router)
app.include_router(webhooks)
app.include_router(officer_auth.router)


@app.middleware("http")
async def prevent_cached_api_responses(request: Request, call_next):
    path = request.url.path
    if path == "/api" or path.startswith("/api/"):
        no_cache = {"Cache-Control": "no-store"}
        if not officer_auth.trusted_write(request):
            return JSONResponse({"detail": "Use the AquaProof site for this action."}, status_code=403,
                                headers=no_cache)
        if (path not in officer_auth.PUBLIC_PATHS and request.method != "OPTIONS"
                and not officer_auth.authorized(request.cookies.get(officer_auth.COOKIE_NAME))):
            return JSONResponse({"detail": "Officer sign-in required."}, status_code=401, headers=no_cache)
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


@app.get("/ready", tags=["health"])
def ready():
    with connect() as connection:
        connection.execute("SELECT 1")
    return {"status": "ready"}
