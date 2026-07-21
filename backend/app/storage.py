from __future__ import annotations

import sqlite3
from pathlib import Path
from threading import Lock

from .schemas import InteractionEvent, LessonResponse


class SQLiteStorage:
    """Small durable store for lesson packages and idempotent interaction events."""

    def __init__(self, database_path: str) -> None:
        if database_path != ":memory:":
            Path(database_path).expanduser().resolve().parent.mkdir(parents=True, exist_ok=True)
        self._connection = sqlite3.connect(database_path, check_same_thread=False)
        self._connection.row_factory = sqlite3.Row
        self._lock = Lock()
        if database_path != ":memory:":
            self._connection.execute("PRAGMA journal_mode=WAL")
        self._connection.execute("PRAGMA foreign_keys=ON")
        self._create_schema()

    def _create_schema(self) -> None:
        with self._connection:
            self._connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS lessons (
                    lesson_id TEXT PRIMARY KEY,
                    payload TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS interaction_events (
                    lesson_id TEXT NOT NULL,
                    session_id TEXT NOT NULL,
                    event_id TEXT NOT NULL,
                    sequence INTEGER NOT NULL,
                    payload TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (lesson_id, session_id, event_id),
                    FOREIGN KEY (lesson_id) REFERENCES lessons(lesson_id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS interaction_events_order
                ON interaction_events (lesson_id, session_id, sequence);
                """
            )

    def save_lesson(self, lesson: LessonResponse) -> None:
        payload = lesson.model_dump_json(by_alias=True)
        with self._lock, self._connection:
            self._connection.execute(
                """
                INSERT INTO lessons (lesson_id, payload) VALUES (?, ?)
                ON CONFLICT(lesson_id) DO UPDATE SET payload=excluded.payload
                """,
                (lesson.lesson_id, payload),
            )

    def get_lesson(self, lesson_id: str) -> LessonResponse | None:
        with self._lock:
            row = self._connection.execute(
                "SELECT payload FROM lessons WHERE lesson_id = ?", (lesson_id,)
            ).fetchone()
        return LessonResponse.model_validate_json(row["payload"]) if row else None

    def add_events(
        self,
        lesson_id: str,
        session_id: str,
        events: list[InteractionEvent],
    ) -> tuple[int, int]:
        accepted = 0
        with self._lock, self._connection:
            for event in events:
                cursor = self._connection.execute(
                    """
                    INSERT OR IGNORE INTO interaction_events
                        (lesson_id, session_id, event_id, sequence, payload)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (
                        lesson_id,
                        session_id,
                        event.event_id,
                        event.sequence,
                        event.model_dump_json(by_alias=True),
                    ),
                )
                accepted += cursor.rowcount
        return accepted, len(events) - accepted

    def list_events(self, lesson_id: str, session_id: str) -> list[InteractionEvent]:
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT payload FROM interaction_events
                WHERE lesson_id = ? AND session_id = ?
                ORDER BY sequence, created_at
                """,
                (lesson_id, session_id),
            ).fetchall()
        return [InteractionEvent.model_validate_json(row["payload"]) for row in rows]

    def close(self) -> None:
        with self._lock:
            self._connection.close()
