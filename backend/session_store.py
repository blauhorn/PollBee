from __future__ import annotations
from dataclasses import dataclass
import os
import secrets
import sqlite3
import threading
import time
from typing import Optional
from uuid import uuid4


@dataclass
class SessionData:
    session_id: str
    base_url: str
    username: str
    app_password: str
    user_id: str
    display_name: str
    created_at: float
    expires_at: Optional[float] = None


class InMemorySessionStore:
    def __init__(self) -> None:
        self._sessions: dict[str, SessionData] = {}

    def create_session(
        self,
        base_url: str,
        username: str,
        app_password: str,
        user_id: str,
        display_name: str,
        ttl_seconds: Optional[int] = None,
    ) -> SessionData:
        now = time.time()
        expires_at = now + ttl_seconds if ttl_seconds else None
        session = SessionData(
            session_id=secrets.token_urlsafe(32),
            base_url=base_url,
            username=username,
            app_password=app_password,
            user_id=user_id,
            display_name=display_name,
            created_at=now,
            expires_at=expires_at,
        )
        self._sessions[session.session_id] = session
        return session

    def get_session(self, session_id: str) -> Optional[SessionData]:
        session = self._sessions.get(session_id)
        if not session:
            return None

        if session.expires_at and session.expires_at < time.time():
            self.delete_session(session_id)
            return None

        return session

    def delete_session(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)

    def cleanup_expired_sessions(self) -> None:
        now = time.time()
        expired_ids = [
            session_id
            for session_id, session in self._sessions.items()
            if session.expires_at and session.expires_at < now
        ]
        for session_id in expired_ids:
            self.delete_session(session_id)
    def touch_session(self, session_id: str, ttl_seconds: int) -> Optional[SessionData]:
        session = self._sessions.get(session_id)
        if not session:
            return None

        if session.expires_at and session.expires_at < time.time():
            self.delete_session(session_id)
            return None

        session.expires_at = time.time() + ttl_seconds
        self._sessions[session_id] = session
        return session


class SQLiteSessionStore:
    def __init__(self, db_path: str) -> None:
        self.db_path = db_path
        self._lock = threading.Lock()
        self._ensure_parent_dir()
        self._init_db()

    def _ensure_parent_dir(self) -> None:
        parent = os.path.dirname(self.db_path)
        if parent:
            os.makedirs(parent, exist_ok=True)

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS sessions (
                    session_id TEXT PRIMARY KEY,
                    base_url TEXT NOT NULL,
                    username TEXT NOT NULL,
                    app_password TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    display_name TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    expires_at REAL
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at)"
            )
            conn.commit()

    def create_session(
        self,
        base_url: str,
        username: str,
        app_password: str,
        user_id: str,
        display_name: str,
        ttl_seconds: Optional[int] = None,
    ) -> SessionData:
        now = time.time()
        expires_at = now + ttl_seconds if ttl_seconds else None

        session = SessionData(
            session_id=secrets.token_urlsafe(32),
            base_url=base_url,
            username=username,
            app_password=app_password,
            user_id=user_id,
            display_name=display_name,
            created_at=now,
            expires_at=expires_at,
        )

        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO sessions (
                    session_id, base_url, username, app_password,
                    user_id, display_name, created_at, expires_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    session.session_id,
                    session.base_url,
                    session.username,
                    session.app_password,
                    session.user_id,
                    session.display_name,
                    session.created_at,
                    session.expires_at,
                ),
            )
            conn.commit()

        return session

    def get_session(self, session_id: str) -> Optional[SessionData]:
        with self._lock, self._connect() as conn:
            row = conn.execute(
                """
                SELECT session_id, base_url, username, app_password,
                       user_id, display_name, created_at, expires_at
                FROM sessions
                WHERE session_id = ?
                """,
                (session_id,),
            ).fetchone()

        if not row:
            return None

        session = SessionData(
            session_id=row["session_id"],
            base_url=row["base_url"],
            username=row["username"],
            app_password=row["app_password"],
            user_id=row["user_id"],
            display_name=row["display_name"],
            created_at=row["created_at"],
            expires_at=row["expires_at"],
        )

        if session.expires_at and session.expires_at < time.time():
            self.delete_session(session_id)
            return None

        return session

    def delete_session(self, session_id: str) -> None:
        with self._lock, self._connect() as conn:
            conn.execute("DELETE FROM sessions WHERE session_id = ?", (session_id,))
            conn.commit()

    def cleanup_expired_sessions(self) -> None:
        now = time.time()
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                DELETE FROM sessions
                WHERE expires_at IS NOT NULL
                  AND expires_at < ?
                """,
                (now,),
            )
            conn.commit()
    def touch_session(self, session_id: str, ttl_seconds: int) -> Optional[SessionData]:
        new_expires_at = time.time() + ttl_seconds

        with self._lock, self._connect() as conn:
            cursor = conn.execute(
                """
                UPDATE sessions
                SET expires_at = ?
                WHERE session_id = ?
                """,
                (new_expires_at, session_id),
            )
            conn.commit()

            if cursor.rowcount == 0:
                return None

            row = conn.execute(
                """
                SELECT session_id, base_url, username, app_password,
                    user_id, display_name, created_at, expires_at
                FROM sessions
                WHERE session_id = ?
                """,
                (session_id,),
            ).fetchone()

        if not row:
            return None

        return SessionData(
            session_id=row["session_id"],
            base_url=row["base_url"],
            username=row["username"],
            app_password=row["app_password"],
            user_id=row["user_id"],
            display_name=row["display_name"],
            created_at=row["created_at"],
            expires_at=row["expires_at"],
        )        

    