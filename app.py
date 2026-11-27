import logging
import os
import secrets
import string
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated

import psycopg
from psycopg_pool import AsyncConnectionPool, ConnectionPool, PoolTimeout
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, HttpUrl, StringConstraints

DATABASE_URL = os.environ["DATABASE_URL"]
# Per-pod connection limit. Keep replicas x (DB_POOL_MAX + 1) below Postgres max_connections.
DB_POOL_MAX = int(os.environ.get("DB_POOL_MAX", "10"))
DB_POOL_TIMEOUT = float(os.environ.get("DB_POOL_TIMEOUT", "10"))
STARTUP_TIMEOUT = float(os.environ.get("DB_STARTUP_TIMEOUT", "30"))
ALPHABET = string.ascii_letters + string.digits
DIST = Path(__file__).parent / "dist"
log = logging.getLogger("uvicorn.error")
Code = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9]{8}$")]


class CreateLink(BaseModel):
    url: HttpUrl


class ShortLink(BaseModel):
    code: str
    short_url: str
    url: str


# Request handlers share this pool. Connections are checked before use, so a
# Postgres restart costs no failed requests once the server is back.
pool = ConnectionPool(
    DATABASE_URL, min_size=1, max_size=DB_POOL_MAX, timeout=DB_POOL_TIMEOUT,
    kwargs={"connect_timeout": 3}, check=ConnectionPool.check_connection, open=False,
)
# /health has its own connection on the event loop, so probes never wait behind
# request threads or for a free connection in the main pool.
health_pool = AsyncConnectionPool(
    DATABASE_URL, min_size=1, max_size=1, timeout=3,
    kwargs={"connect_timeout": 3}, check=AsyncConnectionPool.check_connection, open=False,
)


def create_schema() -> None:
    deadline = time.monotonic() + STARTUP_TIMEOUT
    while True:
        try:
            with pool.connection() as conn:
                # Serialize schema initialization when several API pods start together.
                conn.execute("SELECT pg_advisory_xact_lock(23001)")
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS links (
                        code text PRIMARY KEY,
                        url text NOT NULL
                    )
                """)
            return
        except (psycopg.OperationalError, PoolTimeout) as exc:
            if time.monotonic() > deadline:
                raise
            log.warning("Database not ready, retrying schema setup: %s", exc)
            time.sleep(1)


@asynccontextmanager
async def lifespan(app: FastAPI):
    pool.open()
    await health_pool.open()
    try:
        create_schema()
        yield
    finally:
        await health_pool.close()
        pool.close()


app = FastAPI(title="URL Shortener", lifespan=lifespan)
app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")


@app.exception_handler(psycopg.OperationalError)
@app.exception_handler(PoolTimeout)
def database_unavailable(request: Request, exc: Exception) -> JSONResponse:
    log.warning("Database unavailable during %s %s: %s", request.method, request.url.path, exc)
    return JSONResponse({"detail": "Database unavailable"}, status_code=503)


@app.get("/", include_in_schema=False)
def home():
    return FileResponse(DIST / "index.html")


@app.get("/health")
async def health():
    try:
        async with health_pool.connection() as conn:
            await conn.execute("SELECT 1 FROM links LIMIT 1")
    except (psycopg.Error, PoolTimeout) as exc:
        raise HTTPException(503, "Database unavailable") from exc
    return {"status": "ok"}


@app.post("/api/links", status_code=201)
def create_link(payload: CreateLink, request: Request) -> ShortLink:
    if payload.url.username is not None or payload.url.password is not None:
        raise HTTPException(422, "URLs containing credentials are not supported")
    url = str(payload.url)
    with pool.connection() as conn:
        for _ in range(5):
            code = "".join(secrets.choice(ALPHABET) for _ in range(8))
            row = conn.execute(
                "INSERT INTO links (code, url) VALUES (%s, %s) "
                "ON CONFLICT (code) DO NOTHING RETURNING code",
                (code, url),
            ).fetchone()
            if row:
                return ShortLink(
                    code=code, short_url=str(request.url_for("follow_link", code=code)), url=url
                )
    raise HTTPException(503, "Could not allocate a short link. Please retry.")


@app.get("/s/{code}", response_class=RedirectResponse, status_code=307)
def follow_link(code: Code):
    with pool.connection() as conn:
        row = conn.execute("SELECT url FROM links WHERE code = %s", (code,)).fetchone()
    if row is None:
        raise HTTPException(404, "Short link not found")
    return RedirectResponse(row[0], status_code=307)
