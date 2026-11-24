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


@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler = BackgroundScheduler(timezone="Asia/Karachi")
    scheduler.add_job(deliver_due, "interval", seconds=5, max_instances=1)
    scheduler.add_job(parse_pending, "interval", seconds=10, max_instances=1)
    scheduler.add_job(import_replies, "interval", seconds=60, max_instances=1)
    scheduler.start()
    try:
        yield
    finally:
        scheduler.shutdown(wait=False)


app = FastAPI(title="AquaProof Pakistan API", lifespan=lifespan)
app.include_router(registry_router)
app.include_router(communications_router)


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
