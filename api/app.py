"""Writing Dashboard API — read-only REST API for student writing data."""

import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import auth, data_loader

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    data_loader.load_all()
    auth.init_keys()
    yield


app = FastAPI(
    title="Writing Dashboard API",
    description="Read-only API for the AlphaWrite Writing Student Dashboard.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.get("/health", tags=["Health"])
async def health():
    meta = data_loader.get_metadata()
    students = data_loader.get_students(limit=0)
    loop_students = data_loader.get_loop_students()
    return {
        "status": "ok",
        "service": "writing-dashboard-api",
        "generated_at": meta["generated_at"],
        "student_count": students[1],
        "loop_student_count": len(loop_students),
    }


# ---------------------------------------------------------------------------
# Students
# ---------------------------------------------------------------------------

@app.get("/students", tags=["Students"], dependencies=[Depends(auth.require_api_key)])
async def list_students(
    campus: str | None = Query(None, description="Filter by campus name"),
    level: str | None = Query(None, description="Filter by level (Elementary School, Middle School)"),
    grade: int | None = Query(None, description="Filter by age grade (3-8)"),
    search: str | None = Query(None, description="Search name or email"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=0, le=500),
):
    """List students with optional filters and pagination."""
    students, total = data_loader.get_students(
        campus=campus, level=level, grade=grade, search=search,
        skip=skip, limit=limit,
    )
    meta = data_loader.get_metadata()
    return {
        "students": students,
        "total": total,
        "skip": skip,
        "limit": limit,
        "session": meta["session"],
    }


@app.get("/students/{student_id}", tags=["Students"], dependencies=[Depends(auth.require_api_key)])
async def get_student(student_id: str):
    """Get full student record including test history, XP details, and analysis."""
    student = data_loader.get_student(student_id)
    if not student:
        raise HTTPException(status_code=404, detail="Student not found.")
    return student


# ---------------------------------------------------------------------------
# Loop Students
# ---------------------------------------------------------------------------

@app.get("/loop-students", tags=["Testing Loops"], dependencies=[Depends(auth.require_api_key)])
async def list_loop_students(
    campus: str | None = Query(None, description="Filter by campus"),
    search: str | None = Query(None, description="Search name or email"),
):
    """List students in testing loops with analysis."""
    students = data_loader.get_loop_students(campus=campus, search=search)
    trends = data_loader.get_loop_trends()
    return {
        "students": students,
        "total": len(students),
        "trends": trends,
    }


@app.get("/loop-students/{student_id}", tags=["Testing Loops"], dependencies=[Depends(auth.require_api_key)])
async def get_loop_student(student_id: str):
    """Get full loop student record with test details, skills, and AI analysis."""
    student = data_loader.get_loop_student(student_id)
    if not student:
        raise HTTPException(status_code=404, detail="Loop student not found.")
    return student


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------

@app.get("/stats/sessions", tags=["Stats"], dependencies=[Depends(auth.require_api_key)])
async def session_stats():
    """Per-session aggregate statistics: tests taken, pass rates, scores."""
    stats = data_loader.get_session_stats()
    meta = data_loader.get_metadata()
    return {
        "sessions": stats,
        "current_session": meta["session"],
        "thresholds": meta["thresholds"],
    }


@app.get("/stats/pass-rates", tags=["Stats"], dependencies=[Depends(auth.require_api_key)])
async def pass_rates():
    """Pass rates broken down by grade level."""
    rates = data_loader.get_pass_rates()
    meta = data_loader.get_metadata()
    return {
        "grades": rates,
        "threshold": meta.get("thresholds", {}).get("pass", 87),
    }


# ---------------------------------------------------------------------------
# API Keys
# ---------------------------------------------------------------------------

class ApiKeyRequest(BaseModel):
    name: str


@app.post("/api-keys", tags=["Auth"])
async def create_api_key(request: ApiKeyRequest):
    """Generate a new API key. Add it to the API_KEYS env var on Render to persist across deploys."""
    key = auth.generate_key()
    return {
        "key": key,
        "name": request.name,
        "note": "This key is active now but will be lost on next deploy. "
                "Add it to the API_KEYS environment variable on Render "
                "(comma-separated) to make it permanent.",
    }
