from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .feedback import generate_feedback
from .kinematics import (
    forward_kinematics,
    position_error,
    rotation_error,
    validate_homogeneous,
)
from .orchestrator import create_lesson
from .module_lessons import create_module_lesson
from .scene_service import create_json_scene
from .schemas import (
    AgentTrace,
    EventsAccepted,
    EventsBatch,
    FeedbackRequest,
    HealthResponse,
    LearnerFeedback,
    LessonCreateRequest,
    LessonResponse,
    ModuleLessonCreateRequest,
    ModuleLessonResponse,
    SceneCreateRequest,
    StateErrors,
    ValidateStateRequest,
    ValidateStateResponse,
)
from .storage import SQLiteStorage


app = FastAPI(
    title="Robotics Learning API",
    version="0.1.0",
    description="Verified Canadarm learning activities for standard DH parameters.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

storage = SQLiteStorage(os.getenv("AXISLAB_DB_PATH", ":memory:"))


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(status="ok", service="robotics-learning-api", version="0.1.0")


@app.post("/api/lessons", response_model=LessonResponse)
def lessons_create(payload: LessonCreateRequest) -> LessonResponse:
    lesson = create_lesson(payload.question, payload.provider)
    storage.save_lesson(lesson)
    return lesson


@app.post("/api/module-lessons", response_model=ModuleLessonResponse)
def module_lessons_create(payload: ModuleLessonCreateRequest) -> ModuleLessonResponse:
    return create_module_lesson(payload.question, payload.provider)


@app.post("/api/scenes", response_model=LessonResponse)
def scenes_create(payload: SceneCreateRequest) -> LessonResponse:
    try:
        lesson = create_json_scene(payload)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    storage.save_lesson(lesson)
    return lesson


def _lesson_or_404(lesson_id: str) -> LessonResponse:
    lesson = storage.get_lesson(lesson_id)
    if lesson is None:
        raise HTTPException(status_code=404, detail="lesson not found")
    return lesson


@app.get("/api/lessons/{lesson_id}/trace", response_model=AgentTrace)
def lesson_trace(lesson_id: str) -> AgentTrace:
    """Return the recorded, secret-free orchestration trace for audit and demos."""
    return _lesson_or_404(lesson_id).agent_trace


@app.post(
    "/api/lessons/{lesson_id}/validate-state",
    response_model=ValidateStateResponse,
)
def state_validate(lesson_id: str, payload: ValidateStateRequest) -> ValidateStateResponse:
    lesson = _lesson_or_404(lesson_id)
    try:
        transforms, end_effector = forward_kinematics(
            lesson.robot_spec, payload.joint_values
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    matrix_issues = validate_homogeneous(end_effector)
    client = payload.client_end_effector_transform
    client_position_error = position_error(end_effector, client) if client else None
    client_rotation_error = rotation_error(end_effector, client) if client else None
    valid = not matrix_issues
    if client_position_error is not None and client_rotation_error is not None:
        valid = valid and client_position_error < 1e-6 and client_rotation_error < 1e-6
    return ValidateStateResponse(
        requestSequence=payload.request_sequence,
        valid=valid,
        jointTransforms=transforms,
        endEffectorTransform=end_effector,
        errors=StateErrors(
            position=client_position_error,
            rotation=client_rotation_error,
        ),
    )


@app.post("/api/lessons/{lesson_id}/events", response_model=EventsAccepted)
def events_submit(lesson_id: str, payload: EventsBatch) -> EventsAccepted:
    _lesson_or_404(lesson_id)
    accepted, duplicates = storage.add_events(
        lesson_id, payload.session_id, payload.events
    )
    return EventsAccepted(accepted=accepted, duplicates=duplicates)


@app.post("/api/lessons/{lesson_id}/feedback", response_model=LearnerFeedback)
def feedback_create(lesson_id: str, payload: FeedbackRequest) -> LearnerFeedback:
    lesson = _lesson_or_404(lesson_id)
    events = storage.list_events(lesson_id, payload.session_id)
    return generate_feedback(events, lesson.robot_spec, lesson.activity_spec)


# In a packaged deployment, serve the Vite build from the same origin as the API.
# API routes are registered first so the SPA mount cannot shadow them.
frontend_dist = Path(
    os.getenv(
        "AXISLAB_FRONTEND_DIST",
        Path(__file__).resolve().parents[2] / "frontend" / "dist",
    )
)
if frontend_dist.is_dir():
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")
