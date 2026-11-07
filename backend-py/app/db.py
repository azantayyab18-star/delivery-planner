from __future__ import annotations

import asyncio
import logging
import time
from datetime import timedelta
from typing import Any

from prisma import Json, Prisma

from .logger import log

db = Prisma()


# How long start-up waits for the database (Neon can take a few seconds to wake up) before giving up with a clear error,
# so a stuck connection fails the deploy in minutes instead of Render's 15-minute port timeout.
CONNECT_ATTEMPTS = 4
CONNECT_TIMEOUT_S = 30


async def connect() -> None:
    """Connects with a time limit per attempt and a few retries, logging each step (start-up was silent before)."""
    if db.is_connected():
        return
    for attempt in range(1, CONNECT_ATTEMPTS + 1):
        started = time.monotonic()
        log(logging.INFO, "Connecting to the database", attempt=attempt)
        try:
            await asyncio.wait_for(db.connect(), timeout=CONNECT_TIMEOUT_S)
            log(logging.INFO, "Database connected", seconds=round(time.monotonic() - started, 1))
            return
        except Exception as error:
            log(logging.WARNING, "Database connection failed", attempt=attempt, seconds=round(time.monotonic() - started, 1), error=repr(error)[:300])
            if db.is_connected():
                await db.disconnect()
            if attempt == CONNECT_ATTEMPTS:
                raise
            await asyncio.sleep(5 * attempt)


async def disconnect() -> None:
    if db.is_connected():
        await db.disconnect()


async def is_ready() -> bool:
    if not db.is_connected():
        return False
    try:
        await db.query_raw("SELECT 1")
        return True
    except Exception:  # noqa: BLE001 - readiness probe
        return False


# Prisma's defaults (2 s to start, 5 s to finish) are too tight for a hosted database such as Neon: each query is a
# network round trip, and a request waiting on lock_rider holds its transaction open while another one finishes.
TX_MAX_WAIT = timedelta(seconds=10)
TX_TIMEOUT = timedelta(seconds=30)


def transaction():
    """An interactive transaction with limits that survive database latency and per-rider lock waits."""
    return db.tx(max_wait=TX_MAX_WAIT, timeout=TX_TIMEOUT)


async def lock_rider(tx: Any, rider_id: str) -> None:
    """Holds a per-rider lock until the transaction ends (serialises check-then-insert races across workers)."""
    await tx.query_raw("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))::text AS locked", rider_id)


def as_json(value: Any) -> Json:
    """Prisma needs JSON column values wrapped explicitly."""
    return Json(value)
