from app.schemas import InteractionEvent
from app.storage import SQLiteStorage
from app.orchestrator import create_lesson


def test_sqlite_storage_survives_reopen_and_deduplicates(tmp_path) -> None:
    database = tmp_path / "axislab.db"
    lesson = create_lesson("Explain theta and d in DH", "template")
    event = InteractionEvent(
        eventId="event-persisted",
        sequence=1,
        type="prediction_submitted",
        stepId="predict-d",
        parameterId="joint_1.d",
        answer="translate",
        clientTimestamp="2026-07-20T18:00:00Z",
    )

    first = SQLiteStorage(str(database))
    first.save_lesson(lesson)
    assert first.add_events(lesson.lesson_id, "session-1", [event]) == (1, 0)
    assert first.add_events(lesson.lesson_id, "session-1", [event]) == (0, 1)
    first.close()

    reopened = SQLiteStorage(str(database))
    stored = reopened.get_lesson(lesson.lesson_id)
    assert stored is not None
    assert stored.agent_trace.trace_id == lesson.agent_trace.trace_id
    assert reopened.list_events(lesson.lesson_id, "session-1") == [event]
    reopened.close()
