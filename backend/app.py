from __future__ import annotations

import os
import secrets
import time
from provisioning_client import ProvisioningApiError, ProvisioningClient, ProvisioningCredentials
from register_config import REGISTER_GROUPS

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, HttpUrl
from typing import Any
from fastapi.responses import Response as FastAPIResponse
from nextcloud_client import (
    NextcloudApiError,
    NextcloudClient,
    NextcloudCredentials,
)
from session_store import SQLiteSessionStore, SessionData

app = FastAPI(title="NTSO PollApp API")
FRONTEND_ORIGIN = os.getenv("NEXTCLOUD_BASE_URL")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_ORIGIN],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SESSION_COOKIE_NAME = "pollapp_session"
SESSION_DB_PATH = os.getenv("POLLAPP_SESSION_DB_PATH", "/data/pollapp_sessions.db")
SESSION_TTL_SECONDS = 60 * 60 * 24 * 30 #30 Tage gueltig
LOGIN_FLOW_TTL_SECONDS = 60 * 10  # 10 Minuten
login_flow_store: dict[str, dict] = {}
session_store = SQLiteSessionStore(SESSION_DB_PATH)
API_PREFIX = os.getenv("POLLAPP_API_PREFIX", "/pollapp/api")

class PollCommentPayload(BaseModel):
    comment: str

class LoginRequest(BaseModel):
    baseUrl: HttpUrl
    username: str
    appPassword: str


class VoteRequest(BaseModel):
    optionId: str
    value: str


class LoginFlowStartRequest(BaseModel):
    baseUrl: HttpUrl

class CalendarOptionSelectionPayload(BaseModel):
    optionId: str
    entryStatus: str = "inquiry"


class CalendarEventsPayload(BaseModel):
    calendarUri: str
    title: str
    description: str = ""
    location: str = ""
    optionSelections: list[CalendarOptionSelectionPayload]
    allDay: bool = False
    startTime: str | None = None
    endTime: str | None = None
    pollAppUrl: str = ""

class CreatePollOptionPayload(BaseModel):
    label: str
    timestamp: int


class CreatePollPayload(BaseModel):
    title: str
    description: str = ""
    options: list[CreatePollOptionPayload]
    allowMaybe: bool = True

class CreatePollRequest(BaseModel):
    title: str
    description: str = ""
    allowMaybe: bool = True
    options: list[CreatePollOptionRequest]
    shareGroupIds: list[str] = []

def first_nonempty_str(*values):
    for value in values:
        if value is None:
            continue
        if isinstance(value, str):
            cleaned = value.strip()
            if cleaned:
                return cleaned
        else:
            text = str(value).strip()
            if text and text.lower() != "none":
                return text
    return ""

def build_client_from_session(session: SessionData) -> NextcloudClient:
    return NextcloudClient(
        NextcloudCredentials(
            base_url=session.base_url,
            username=session.username,
            app_password=session.app_password,
        )
    )


def build_provisioning_client() -> ProvisioningClient:
    base_url = os.environ.get("NEXTCLOUD_BASE_URL", "").rstrip("/")
    admin_username = os.environ.get("NEXTCLOUD_ADMIN_USERNAME", "")
    admin_app_password = os.environ.get("NEXTCLOUD_ADMIN_APP_PASSWORD", "")

    if not base_url or not admin_username or not admin_app_password:
        raise HTTPException(
            status_code=500,
            detail="Provisioning API credentials are not configured",
        )

    return ProvisioningClient(
        ProvisioningCredentials(
            base_url=base_url,
            username=admin_username,
            app_password=admin_app_password,
        )
    )


def get_current_session(request: Request) -> SessionData:
    session_store.cleanup_expired_sessions()
    session_id = request.cookies.get(SESSION_COOKIE_NAME)
    if not session_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    session = session_store.get_session(session_id)
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    
    refreshed_session = session_store.touch_session(session_id, SESSION_TTL_SECONDS)
    if refreshed_session:
        return refreshed_session

    return session


def normalize_identity(value: str | None) -> str:
    if not value:
        return ""
    return value.strip().lower()


def extract_vote_user_identifiers(user: dict) -> list[str]:
    identifiers = []

    candidates = [
        user.get("user"),
        user.get("userId"),
        user.get("id"),
        user.get("emailAddress"),
        user.get("displayName"),
    ]

    for candidate in candidates:
        normalized = normalize_identity(str(candidate)) if candidate is not None else ""
        if normalized and normalized not in identifiers:
            identifiers.append(normalized)

    return identifiers


def get_all_register_members(provisioning_client: ProvisioningClient) -> tuple[set[str], dict[str, str]]:
    """
    Liefert:
    - Set aller normierten Mitglieder aus allen konfigurierten Registern
    - Mapping normierte Kennung -> Anzeige-/User-ID
    """
    all_members_normalized: set[str] = set()
    display_by_normalized: dict[str, str] = {}

    for register in REGISTER_GROUPS:
        members = provisioning_client.get_group_members(register["groupId"])
        for member_user_id in members:
            normalized = normalize_identity(member_user_id)
            if normalized:
                all_members_normalized.add(normalized)
                display_by_normalized.setdefault(normalized, member_user_id)

    return all_members_normalized, display_by_normalized


def get_registered_option_answer_counts(
    raw_votes: list[dict],
    registered_members_normalized: set[str],
) -> dict[str, int]:
    """
    Zählt pro Option, wie viele Mitglieder aus den Registern überhaupt
    eine Antwort zu dieser Option abgegeben haben.
    """
    answered_users_by_option: dict[str, set[str]] = {}

    for vote in raw_votes:
        option_id = str(vote.get("optionId", ""))
        if not option_id:
            continue

        user = vote.get("user") or {}
        identifiers = extract_vote_user_identifiers(user)

        matching_registered_ids = [
            identifier
            for identifier in identifiers
            if identifier in registered_members_normalized
        ]

        if not matching_registered_ids:
            continue

        primary_registered_id = matching_registered_ids[0]
        answered_users_by_option.setdefault(option_id, set()).add(primary_registered_id)

    return {
        option_id: len(answered_users)
        for option_id, answered_users in answered_users_by_option.items()
    }


def build_poll_option_list(
    raw_options: list[dict],
    option_answer_counts: dict[str, int] | None = None,
    total_registered_members: int | None = None,
) -> list[dict]:
    options: list[dict] = []

    for option in raw_options:
        option_id = str(option.get("id"))
        option_votes = option.get("votes", {}) or {}

        if not isinstance(option_votes, dict):
            option_votes = {}

        current_user_vote = option_votes.get("currentUser")

        missing = None
        if total_registered_members is not None and option_answer_counts is not None:
            answered_count = option_answer_counts.get(option_id, 0)
            missing = max(0, total_registered_members - answered_count)

        options.append(
            {
                "id": option_id,
                "label": option.get("text") or f"Option {option_id}",
                "timestamp": option.get("timestamp"),
                "confirmed": option.get("confirmed", 0),
                "voteSummary": {
                    "yes": int(option_votes.get("yes", 0) or 0),
                    "no": int(option_votes.get("no", 0) or 0),
                    "maybe": int(option_votes.get("maybe", 0) or 0),
                    "count": int(option_votes.get("count", 0) or 0),
                    "missing": missing,
                    "currentUser": current_user_vote if current_user_vote in ("yes", "no", "maybe") else None,
                },
            }
        )

    return options


def build_poll_list_item(
    raw_poll: dict,
    raw_options: list[dict],
    raw_votes: list[dict],
    registered_members_normalized: set[str],
) -> dict:
    configuration = raw_poll.get("configuration", {}) or {}

    title = configuration.get("title") or raw_poll.get("title") or "Ohne Titel"
    description = configuration.get("description") or raw_poll.get("description") or ""
    due_date = raw_poll.get("expire") or configuration.get("expire") or ""
    raw_status = str(raw_poll.get("status", "open"))
    configuration = raw_poll.get("configuration", {}) or {}

    is_closed = bool(
        raw_poll.get("closed")
        or raw_poll.get("isClosed")
        or configuration.get("closed")
        or configuration.get("isClosed")
        or raw_status.lower() in {"closed", "expired", "done", "archived"}
    )

    status = raw_status
    poll_id = str(raw_poll.get("id"))

    option_answer_counts = get_registered_option_answer_counts(
        raw_votes=raw_votes,
        registered_members_normalized=registered_members_normalized,
    )

    options = build_poll_option_list(
        raw_options=raw_options,
        option_answer_counts=option_answer_counts,
        total_registered_members=len(registered_members_normalized),
    )

    summary_text = ""
    if options:
        total_yes = sum(option["voteSummary"]["yes"] for option in options)
        total_no = sum(option["voteSummary"]["no"] for option in options)
        total_maybe = sum(option["voteSummary"]["maybe"] for option in options)
        summary_text = f"{len(options)} Optionen · Ja {total_yes} · Nein {total_no} · Vielleicht {total_maybe}"

    owner = raw_poll.get("owner") or {}
    created = raw_poll.get("status", {}).get("created") or raw_poll.get("created")


    return {
        "id": poll_id,
        "title": title,
        "description": description,
        "status": status,
        "isClosed": is_closed,
        "dueDate": str(due_date) if due_date else "",
        "summaryText": summary_text,
        "options": options,
        "owner": owner.get("displayName") or owner.get("userId") or "",
        "created": created,
    }

def normalize_base_url(value: str) -> str:
    base_url = value.strip().rstrip("/")
    if base_url.endswith("/index.php"):
        base_url = base_url[: -len("/index.php")]
    return base_url


def cleanup_expired_login_flows() -> None:
    now = time.time()
    expired_keys = [
        state_id
        for state_id, state in login_flow_store.items()
        if now - state.get("created_at", 0) > LOGIN_FLOW_TTL_SECONDS
    ]
    for state_id in expired_keys:
        login_flow_store.pop(state_id, None)

def extract_poll_closed_state(raw_poll: dict, detail_poll_data: dict | None = None) -> tuple[bool, str]:
    """
    Liefert:
    - is_closed
    - status_text für Debug/Frontend
    """
    poll_sources = [detail_poll_data or {}, raw_poll or {}]

    for source in poll_sources:
        status_obj = source.get("status") or {}
        current_user_status = source.get("currentUserStatus") or {}
        configuration = source.get("configuration") or {}

        if not isinstance(status_obj, dict):
            status_obj = {}
        if not isinstance(current_user_status, dict):
            current_user_status = {}

        # Sicher erkannte Fälle
        if status_obj.get("isArchived") is True:
            return True, "archived"

        if status_obj.get("isExpired") is True:
            return True, "expired"

        # Manche Polls werden als "locked" gemeldet
        if current_user_status.get("isLocked") is True:
            return True, "locked"

        # Fallback-Felder, falls vorhanden
        if source.get("closed") is True or source.get("isClosed") is True:
            return True, "closed"

        if configuration.get("closed") is True or configuration.get("isClosed") is True:
            return True, "closed"

    return False, "open"

def extract_owner_id(poll_data: dict) -> str:
    owner_data = poll_data.get("owner") or {}

    if isinstance(owner_data, dict):
        return str(
            owner_data.get("userId")
            or owner_data.get("id")
            or owner_data.get("user")
            or owner_data.get("emailAddress")
            or ""
        ).strip()

    if isinstance(owner_data, str):
        return owner_data.strip()

    return ""

def build_calendar_summary(base_title: str, entry_status: str) -> str:
    prefix_map = {
        "inquiry": "[ANFRAGE]",
        "fixed": "[FIX]",
        "canceled": "[CANCELED]",
    }

    normalized_status = str(entry_status or "").strip().lower()
    prefix = prefix_map.get(normalized_status, "[ANFRAGE]")

    title = str(base_title or "").strip() or "Umfragetermin"
    return f"{prefix} {title}"

def is_current_user_poll_admin(poll_data: dict, session) -> bool:
    owner_id = extract_owner_id(poll_data)
    current_user_id = str(session.user_id).strip()

    if owner_id and str(owner_id).strip() == current_user_id:
        return True

    raw_shares = poll_data.get("shares", []) or []

    for share in raw_shares:
        if not isinstance(share, dict) or share.get("deleted"):
            continue

        user = share.get("user") or {}
        if not isinstance(user, dict):
            continue

        share_user_id = str(
            user.get("userId")
            or user.get("id")
            or user.get("user")
            or user.get("emailAddress")
            or ""
        ).strip()

        if share_user_id == current_user_id and bool(user.get("isUnrestrictedOwner")):
            return True

    return False

def get_poll_with_shares(client, poll_id: str) -> dict:
    raw_poll_response = client.get_poll(poll_id)
    poll_data = raw_poll_response.get("poll", raw_poll_response)

    shares = (
        poll_data.get("shares", [])
        or raw_poll_response.get("shares", [])
        or []
    )

    if shares:
        poll_data["shares"] = shares

    return poll_data

@app.get("/")
def root():
    return {"message": "PollApp backend läuft"}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/auth/login")
def login(payload: LoginRequest, response: Response):
    credentials = NextcloudCredentials(
        base_url=str(payload.baseUrl).rstrip("/"),
        username=payload.username,
        app_password=payload.appPassword,
    )
    client = NextcloudClient(credentials)

    try:
        user_data = client.validate_credentials()
    except NextcloudApiError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc

    session = session_store.create_session(
        base_url=credentials.base_url,
        username=credentials.username,
        app_password=credentials.app_password,
        user_id=user_data.get("id", credentials.username),
        display_name=user_data.get("display-name", credentials.username),
        ttl_seconds=SESSION_TTL_SECONDS,
    )

    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=session.session_id,
        httponly=True,
        secure=True,
        samesite="lax",
        path="/",
        max_age=SESSION_TTL_SECONDS,
    )

    return {
        "user": {
            "id": session.user_id,
            "displayName": session.display_name,
        }
    }


@app.post("/auth/logout")
def logout(request: Request, response: Response):
    session_id = request.cookies.get(SESSION_COOKIE_NAME)
    if session_id:
        session_store.delete_session(session_id)

    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        path="/",
    )

    return {"success": True}


@app.get("/auth/me")
def auth_me(request: Request, response: Response):
    session = get_current_session(request)

    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=session.session_id,
        httponly=True,
        secure=True,
        samesite="lax",
        path="/",
        max_age=SESSION_TTL_SECONDS,
    )

    return {
        "id": session.user_id,
        "displayName": session.display_name,
        "serverUrl": session.base_url,
        "avatarUrl": f"{API_PREFIX}/auth/avatar",
        "logoUrl": f"{API_PREFIX}/auth/logo",
        
    }
    
@app.get("/auth/avatar")
def auth_avatar(request: Request):
    session = get_current_session(request)
    client = build_client_from_session(session)

    avatar_path_candidates = [
        f"/avatar/{session.user_id}/128",
        f"/index.php/avatar/{session.user_id}/128",
    ]

    last_error = None

    for avatar_path in avatar_path_candidates:
        try:
            response = client._request("GET", avatar_path)
            if response.status_code == 200 and response.content:
                content_type = response.headers.get("Content-Type", "image/png")
                return FastAPIResponse(content=response.content, media_type=content_type)
        except Exception as exc:
            last_error = exc

    if last_error:
        print(f"DEBUG auth_avatar failed: {last_error}")

    raise HTTPException(status_code=404, detail="Avatar not found")    

@app.get("/auth/logo")
def auth_logo(request: Request):
    session = get_current_session(request)
    client = build_client_from_session(session)

    logo_path_candidates = [
        "/core/img/logo/logo-title.svg",
        "/index.php/core/img/logo/logo-title.svg",
        "/core/img/logo/logo.svg",
        "/index.php/core/img/logo/logo.svg",
    ]

    last_error = None

    for logo_path in logo_path_candidates:
        try:
            response = client._request("GET", logo_path)
            if response.status_code == 200 and response.content:
                content_type = response.headers.get("Content-Type", "image/svg+xml")
                return FastAPIResponse(content=response.content, media_type=content_type)
        except Exception as exc:
            last_error = exc

    if last_error:
        print(f"DEBUG auth_logo failed: {last_error}")

    raise HTTPException(status_code=404, detail="Logo not found")

@app.post("/auth/login-flow/start")
def login_flow_start(payload: LoginFlowStartRequest):
    cleanup_expired_login_flows()

    base_url = normalize_base_url(str(payload.baseUrl))

    try:
        login_flow_data = NextcloudClient.start_login_flow_v2(base_url)
    except NextcloudApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    poll_data = login_flow_data.get("poll") or {}
    login_url = login_flow_data.get("login")

    token = poll_data.get("token")
    poll_endpoint = poll_data.get("endpoint")

    if not token or not poll_endpoint or not login_url:
        raise HTTPException(
            status_code=502,
            detail="Invalid login flow response from Nextcloud",
        )

    state_id = secrets.token_urlsafe(24)
    login_flow_store[state_id] = {
        "state_id": state_id,
        "created_at": time.time(),
        "status": "pending",
        "base_url": base_url,
        "poll_token": token,
        "poll_endpoint": poll_endpoint,
        "login_url": login_url,
        "session_id": None,
        "user": None,
        "error": None,
    }

    return {
        "stateId": state_id,
        "loginUrl": login_url,
        "expiresIn": LOGIN_FLOW_TTL_SECONDS,
    }


@app.get("/auth/login-flow/status/{state_id}")
def login_flow_status(state_id: str, response: Response):
    cleanup_expired_login_flows()

    state = login_flow_store.get(state_id)
    if not state:
        raise HTTPException(status_code=404, detail="Login flow not found or expired")

    if state["status"] == "failed":
        return {
            "status": "failed",
            "error": state.get("error") or "Login flow failed",
        }

    if state["status"] == "done":
        if state.get("session_id"):
            response.set_cookie(
                key=SESSION_COOKIE_NAME,
                value=state["session_id"],
                httponly=True,
                secure=True,
                samesite="lax",
                path="/",
                max_age=SESSION_TTL_SECONDS,
            )

        return {
            "status": "done",
            "user": state.get("user"),
        }

    try:
        poll_result = NextcloudClient.poll_login_flow_v2(
            poll_endpoint=state["poll_endpoint"],
            token=state["poll_token"],
        )
    except NextcloudApiError as exc:
        state["status"] = "failed"
        state["error"] = str(exc)
        return {
            "status": "failed",
            "error": str(exc),
        }

    if poll_result is None:
        return {"status": "pending"}

    server = normalize_base_url(str(poll_result.get("server", "")))
    login_name = poll_result.get("loginName")
    app_password = poll_result.get("appPassword")

    if not server or not login_name or not app_password:
        state["status"] = "failed"
        state["error"] = "Incomplete login flow result from Nextcloud"
        return {
            "status": "failed",
            "error": state["error"],
        }

    credentials = NextcloudCredentials(
        base_url=server,
        username=login_name,
        app_password=app_password,
    )
    client = NextcloudClient(credentials)

    try:
        user_data = client.validate_credentials()
    except NextcloudApiError as exc:
        state["status"] = "failed"
        state["error"] = f"Credential validation failed: {exc}"
        return {
            "status": "failed",
            "error": state["error"],
        }

    session = session_store.create_session(
        base_url=credentials.base_url,
        username=credentials.username,
        app_password=credentials.app_password,
        user_id=user_data.get("id", credentials.username),
        display_name=user_data.get("display-name", credentials.username),
        ttl_seconds=SESSION_TTL_SECONDS,
    )

    state["status"] = "done"
    state["session_id"] = session.session_id
    state["user"] = {
        "id": session.user_id,
        "displayName": session.display_name,
    }

    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=session.session_id,
        httponly=True,
        secure=True,
        samesite="lax",
        path="/",
        max_age=SESSION_TTL_SECONDS,
    )

    return {
        "status": "done",
        "user": state["user"],
    }

@app.get("/polls")
def get_polls(request: Request):
    session = get_current_session(request)
    client = build_client_from_session(session)
    provisioning_client = build_provisioning_client()

    try:
        raw_polls = client.get_polls()
    except NextcloudApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    try:
        registered_members_normalized, _ = get_all_register_members(provisioning_client)
    except ProvisioningApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    poll_list = []

    for raw_poll in raw_polls:
        poll_id = str(raw_poll.get("id"))
        configuration = raw_poll.get("configuration", {}) or {}
        print(f"DEBUG POLL LIST ITEM: id={poll_id} title={configuration.get('title') or raw_poll.get('title')}")
       

        detail_poll_data = None
        detail_configuration = {}

        try:
            raw_poll_response = client.get_poll(poll_id)
            detail_poll_data = raw_poll_response.get("poll", raw_poll_response)
            detail_configuration = detail_poll_data.get("configuration", {}) or {}
        except NextcloudApiError as exc:
            print(f"DEBUG /polls detail failed for poll {poll_id}: {exc}")

        is_closed, derived_status = extract_poll_closed_state(
            raw_poll=raw_poll,
            detail_poll_data=detail_poll_data,
        )

        effective_configuration = {
            **configuration,
            **detail_configuration,
        }

        effective_due_date = (
            (detail_poll_data or {}).get("expire")
            or effective_configuration.get("expire")
            or raw_poll.get("expire")
            or configuration.get("expire")
            or ""
        )

        # Optional: gezielt nur Probenlager debuggen
        if (
            effective_configuration.get("title") == "Probenlager"
            or raw_poll.get("configuration", {}).get("title") == "Probenlager"
        ):
            print(f"\n=== DEBUG POLL {poll_id} ===")
            print("LIST RAW:", raw_poll)
            print("DETAIL RAW:", detail_poll_data)
            print("DERIVED CLOSED:", is_closed)
            print("DERIVED STATUS:", derived_status)
            print("===========================\n")

        try:
            raw_options = client.get_poll_options(poll_id)
            raw_votes = client.get_poll_votes(poll_id)

            source_poll = detail_poll_data or raw_poll

            poll_item = build_poll_list_item(
                raw_poll=source_poll,
                raw_options=raw_options,
                raw_votes=raw_votes,
                registered_members_normalized=registered_members_normalized,
            )

            poll_item["status"] = derived_status
            poll_item["isClosed"] = is_closed
            poll_item["dueDate"] = str(effective_due_date) if effective_due_date else ""

            poll_list.append(poll_item)

        except NextcloudApiError as exc:
            print(f"DEBUG /polls data failed for poll {poll_id}: {exc}")

            poll_list.append(
                {
                    "id": poll_id,
                    "title": effective_configuration.get("title")
                    or (detail_poll_data or {}).get("title")
                    or raw_poll.get("title")
                    or "Ohne Titel",
                    "description": effective_configuration.get("description")
                    or (detail_poll_data or {}).get("description")
                    or raw_poll.get("description")
                    or "",
                    "status": derived_status,
                    "isClosed": is_closed,
                    "dueDate": str(effective_due_date) if effective_due_date else "",
                    "summaryText": "",
                    "options": [],
                }
            )

    return poll_list

@app.get("/polls/{poll_id}")
def get_poll_by_id(poll_id: str, request: Request):
    session = get_current_session(request)
    client = build_client_from_session(session)

    try:
        raw_poll_response = client.get_poll(poll_id)
        raw_options = client.get_poll_options(poll_id)
        raw_votes = client.get_poll_votes(poll_id)
    except NextcloudApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    poll_data = raw_poll_response.get("poll", raw_poll_response)
    configuration = poll_data.get("configuration", {})

    owner_data = poll_data.get("owner") or {}
    owner_id = extract_owner_id(poll_data)
    is_owner = bool(owner_id) and owner_id == str(session.user_id).strip()

    if isinstance(owner_data, dict):
        owner_id = str(
            owner_data.get("userId")
            or owner_data.get("id")
            or owner_data.get("user")
            or owner_data.get("emailAddress")
            or ""
        ).strip()
    elif isinstance(owner_data, str):
        owner_id = owner_data.strip()

    is_owner = bool(owner_id) and owner_id == str(session.user_id).strip()

    raw_shares = (
    poll_data.get("shares", [])
    or raw_poll_response.get("shares", [])
    or []
    )

    shares = []
    is_poll_admin = is_owner

    for share in raw_shares:
        if not isinstance(share, dict):
            continue

        user = share.get("user") or {}
        if not isinstance(user, dict):
            user = {}

        share_user_id = str(
            user.get("userId")
            or user.get("id")
            or user.get("user")
            or user.get("emailAddress")
            or ""
        ).strip()

        is_unrestricted_owner = bool(user.get("isUnrestrictedOwner"))

        if (
            share_user_id
            and share_user_id == str(session.user_id).strip()
            and is_unrestricted_owner
            and not share.get("deleted", False)
        ):
            is_poll_admin = True

        shares.append(
            {
                "id": share.get("id"),
                "token": share.get("token"),
                "type": share.get("type"),
                "pollId": share.get("pollId"),
                "groupId": share.get("groupId"),
                "label": share.get("label", ""),
                "deleted": bool(share.get("deleted", False)),
                "locked": bool(share.get("locked", False)),
                "user": {
                    "id": share_user_id,
                    "userId": user.get("userId"),
                    "user": user.get("user"),
                    "displayName": user.get("displayName") or share_user_id,
                    "emailAddress": user.get("emailAddress"),
                    "isAdmin": bool(user.get("isAdmin", False)),
                    "isGuest": bool(user.get("isGuest", False)),
                    "isNoUser": bool(user.get("isNoUser", False)),
                    "isUnrestrictedOwner": is_unrestricted_owner,
                    "type": user.get("type"),
                },
            }
        )

    raw_comments = (
        poll_data.get("comments", [])
        or raw_poll_response.get("comments", [])
        or []
    )

    title = configuration.get("title") or poll_data.get("title") or "Ohne Titel"
    description = configuration.get("description") or poll_data.get("description") or ""

    expire = configuration.get("expire", 0)
    due_date = ""
    if isinstance(expire, (int, float)) and expire > 0:
        due_date = str(expire)

    raw_status = poll_data.get("status", {})
    current_user_status = poll_data.get("currentUserStatus", {}) or {}

    if not isinstance(raw_status, dict):
        raw_status = {}

    if not isinstance(current_user_status, dict):
        current_user_status = {}

    is_closed = bool(
        raw_status.get("isArchived")
        or raw_status.get("isExpired")
        or current_user_status.get("isLocked")
        or poll_data.get("closed")
        or poll_data.get("isClosed")
        or configuration.get("closed")
        or configuration.get("isClosed")
    )

    status = "closed" if is_closed else "open"

    raw_allow_maybe = configuration.get("allowMaybe", False)
    allow_maybe = bool(raw_allow_maybe)

    raw_anonymous = configuration.get("anonymous", False)
    anonymous = bool(raw_anonymous)

    options = []
    current_votes: dict[str, str] = {}

    for option in raw_options:
        option_id = str(option.get("id"))
        option_votes = option.get("votes", {}) or {}

        current_user_vote = option_votes.get("currentUser")
        if current_user_vote in ("yes", "no", "maybe"):
            current_votes[option_id] = current_user_vote

        options.append(
            {
                "id": option_id,
                "label": option.get("text") or f"Option {option_id}",
                "timestamp": option.get("timestamp"),
                "confirmed": option.get("confirmed", 0),
                "voteSummary": {
                    "yes": option_votes.get("yes", 0),
                    "no": option_votes.get("no", 0),
                    "maybe": option_votes.get("maybe", 0),
                    "count": option_votes.get("count", 0),
                    "currentUser": current_user_vote,
                },
            }
        )

    participants_by_user: dict[str, dict] = {}
    option_ids = [str(option.get("id")) for option in raw_options]
    comments_by_user_identifier: dict[str, dict] = {}

    def norm(value) -> str:
        if value is None:
            return ""
        return str(value).strip().lower()

    for comment in raw_comments:
        user = comment.get("user") or {}

        comment_text = comment.get("comment") or ""
        comment_timestamp = comment.get("timestamp")

        if not isinstance(comment_text, str) or not comment_text.strip():
            continue

        comment_payload = {
            "comment": comment_text.strip(),
            "timestamp": int(comment_timestamp) if isinstance(comment_timestamp, (int, float)) else None,
        }

        identifiers = {
            norm(user.get("userId")),
            norm(user.get("id")),
            norm(user.get("user")),
            norm(user.get("displayName")),
            norm(user.get("emailAddress")),
        }

        for identifier in identifiers:
            if identifier:
                comments_by_user_identifier[identifier] = comment_payload

    for vote in raw_votes:
        user = vote.get("user") or {}

        participant_id = (
            user.get("userId")
            or user.get("id")
            or user.get("user")
            or user.get("emailAddress")
            or user.get("displayName")
        )

        if not participant_id:
            continue

        participant_key = str(participant_id).strip()

        identifiers = [
            norm(user.get("userId")),
            norm(user.get("id")),
            norm(user.get("user")),
            norm(user.get("displayName")),
            norm(user.get("emailAddress")),
        ]

        participant_comment = None
        for identifier in identifiers:
            if identifier and identifier in comments_by_user_identifier:
                participant_comment = comments_by_user_identifier[identifier]
                break

        if participant_key not in participants_by_user:
            participants_by_user[participant_key] = {
                "participantId": participant_key,
                "displayName": user.get("displayName") or participant_key,
                "emailAddress": user.get("emailAddress"),
                "type": user.get("type"),
                "isGuest": user.get("isGuest", False),
                "isNoUser": user.get("isNoUser", False),
                "answersByOption": {},
                "publicComment": participant_comment.get("comment") if participant_comment else "",
                "publicCommentTimestamp": participant_comment.get("timestamp") if participant_comment else None,
            }

        option_id = str(vote.get("optionId", ""))
        answer = vote.get("answer", "")
        participants_by_user[participant_key]["answersByOption"][option_id] = answer

    participants = []
    missing_participants = []
    total_option_count = len(option_ids)

    for participant in participants_by_user.values():
        answered_count = len(participant["answersByOption"])

        if answered_count == 0:
            completion_status = "none"
        elif answered_count < total_option_count:
            completion_status = "partial"
        else:
            completion_status = "complete"

        participant_result = {
            **participant,
            "answeredCount": answered_count,
            "totalOptionCount": total_option_count,
            "completionStatus": completion_status,
        }

        participants.append(participant_result)

        if completion_status != "complete":
            missing_participants.append(
                {
                    "participantId": participant["participantId"],
                    "displayName": participant["displayName"],
                    "answeredCount": answered_count,
                    "totalOptionCount": total_option_count,
                    "completionStatus": completion_status,
                }
            )

    participants.sort(key=lambda item: (item["displayName"] or "").lower())
    missing_participants.sort(key=lambda item: (item["displayName"] or "").lower())

    return {
        "id": str(poll_data.get("id", poll_id)),
        "type": poll_data.get("type"),
        "title": title,
        "description": description,
        "status": status,
        "isClosed": is_closed,
        "dueDate": due_date,
        "summaryText": "",
        "allowMaybe": allow_maybe,
        "anonymous": anonymous,
        "showResults": configuration.get("showResults"),
        "debugConfiguration": {
            "allowMaybeRaw": raw_allow_maybe,
            "allowMaybeRawType": str(type(raw_allow_maybe)),
            "pollKeys": list(poll_data.keys()),
            "responseKeys": list(raw_poll_response.keys()) if isinstance(raw_poll_response, dict) else [],
        },
        "options": options,
        "participants": participants,
        "missingParticipants": missing_participants,
        "currentVotes": current_votes,
        "currentUser": {
            "id": session.user_id,
            "displayName": session.display_name,
        },
        "permissions": {
            "isOwner": is_owner,
            "isPollAdmin": is_poll_admin,
            "canToggleClosed": is_poll_admin,
            "canManagePoll": is_poll_admin,
            "canManageAuthors": is_owner,
        },
        "shares": shares,
        
    }

@app.post("/polls/{poll_id}/toggle-closed")
def toggle_poll_closed(poll_id: str, request: Request):
    session = get_current_session(request)
    client = build_client_from_session(session)

    try:
        raw_poll_response = client.get_poll(poll_id)
    except NextcloudApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    poll_data = raw_poll_response.get("poll", raw_poll_response)
    configuration = poll_data.get("configuration", {})

    owner_id = extract_owner_id(poll_data)
   

    poll_detail = get_poll_by_id(poll_id, request)

    if not poll_detail.get("permissions", {}).get("isPollAdmin", False):
        raise HTTPException(
            status_code=403,
            detail="Nur Eigentümer oder Co-Autoren dürfen die Umfrage verwalten.",
        )

    raw_status = poll_data.get("status", {})
    current_user_status = poll_data.get("currentUserStatus", {}) or {}

    if not isinstance(raw_status, dict):
        raw_status = {}

    if not isinstance(current_user_status, dict):
        current_user_status = {}

    is_closed = bool(
        raw_status.get("isArchived")
        or raw_status.get("isExpired")
        or current_user_status.get("isLocked")
        or poll_data.get("closed")
        or poll_data.get("isClosed")
        or configuration.get("closed")
        or configuration.get("isClosed")
    )

    try:
        if is_closed:
            client.reopen_poll(poll_id)
        else:
            client.close_poll(poll_id)
    except NextcloudApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return {
        "ok": True,
        "poll": get_poll_by_id(poll_id, request),
    }

@app.get("/polls/{poll_id}/debug")
def get_poll_debug(poll_id: str, request: Request):
    session = get_current_session(request)
    client = build_client_from_session(session)

    try:
        raw_poll = client.get_poll(poll_id)
        raw_options = client.get_poll_options(poll_id)
        raw_votes = client.get_poll_votes(poll_id)
    except NextcloudApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return {
        "poll": raw_poll,
        "options": raw_options,
        "votes": raw_votes,
        "currentUser": {
            "id": session.user_id,
            "displayName": session.display_name,
        },
    }


@app.post("/polls/{poll_id}/votes")
def submit_vote(poll_id: str, payload: VoteRequest, request: Request):
    session = get_current_session(request)
    client = build_client_from_session(session)

    normalized_value = str(payload.value).strip().lower()
    if normalized_value not in {"yes", "no", "maybe"}:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported vote value: {payload.value}",
        )

    option_id = str(payload.optionId).strip()
    if not option_id:
        raise HTTPException(
            status_code=400,
            detail="optionId is required",
        )

    try:
        result = client.submit_vote(
            poll_id=str(poll_id).strip(),
            option_id=option_id,
            value=normalized_value,
        )
    except NextcloudApiError as exc:
        print(
            "DEBUG submit_vote failed:",
            {
                "poll_id": poll_id,
                "option_id": option_id,
                "value": normalized_value,
                "error": str(exc),
            },
        )
        raise HTTPException(
            status_code=502,
            detail=f"Vote submit failed for poll {poll_id}, option {option_id}: {exc}",
        ) from exc
    except Exception as exc:
        print(
            "DEBUG submit_vote unexpected error:",
            {
                "poll_id": poll_id,
                "option_id": option_id,
                "value": normalized_value,
                "error": repr(exc),
            },
        )
        raise HTTPException(
            status_code=500,
            detail=f"Unexpected vote submit error: {exc}",
        ) from exc

    return {
        "success": True,
        "result": result,
    }

@app.get("/polls/{poll_id}/register-summary")
def get_poll_register_summary(poll_id: str, request: Request):
    session = get_current_session(request)
    client = build_client_from_session(session)
    provisioning_client = build_provisioning_client()

    try:
        raw_votes = client.get_poll_votes(poll_id)
        raw_options = client.get_poll_options(poll_id)
    except NextcloudApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    try:
        register_members: dict[str, list[str]] = {}
        for register in REGISTER_GROUPS:
            group_id = register["groupId"]
            display_name = register["displayName"]
            members = provisioning_client.get_group_members(group_id)
            register_members[display_name] = members
    except ProvisioningApiError as exc:
        print(f"DEBUG register-summary provisioning error: {exc}")
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    option_ids = sorted(
        {str(option.get("id")) for option in raw_options if option.get("id") is not None}
    )
    total_option_count = len(option_ids)

    participants_by_identity: dict[str, dict] = {}

    for vote in raw_votes:
        user = vote.get("user") or {}
        identifiers = extract_vote_user_identifiers(user)

        if not identifiers:
            continue

        primary_identifier = identifiers[0]

        if primary_identifier not in participants_by_identity:
            participants_by_identity[primary_identifier] = {
                "displayName": user.get("displayName") or primary_identifier,
                "emailAddress": user.get("emailAddress"),
                "answersByOption": {},
                "identifiers": identifiers,
            }

        option_id = str(vote.get("optionId", ""))
        answer = vote.get("answer", "")
        participants_by_identity[primary_identifier]["answersByOption"][option_id] = answer

    register_summary = []

    for register_name, members in register_members.items():
        complete_members = []
        partial_members = []
        missing_members = []

        for member_user_id in members:
            normalized_member_id = normalize_identity(member_user_id)

            matched_participant = None

            for participant in participants_by_identity.values():
                participant_identifiers = participant.get("identifiers", [])
                if normalized_member_id in participant_identifiers:
                    matched_participant = participant
                    break

            if not matched_participant:
                missing_members.append(
                    {
                        "userId": member_user_id,
                        "displayName": member_user_id,
                    }
                )
                continue

            answered_count = len(matched_participant["answersByOption"])

            member_info = {
                "userId": member_user_id,
                "displayName": matched_participant["displayName"],
            }

            if answered_count == 0:
                missing_members.append(member_info)
            elif answered_count < total_option_count:
                partial_members.append(
                    {
                        **member_info,
                        "answeredCount": answered_count,
                        "totalOptionCount": total_option_count,
                    }
                )
            else:
                complete_members.append(member_info)

        if len(missing_members) > 0:
            traffic_light = "red"
        elif len(partial_members) > 0:
            traffic_light = "yellow"
        else:
            traffic_light = "green"

        register_summary.append(
            {
                "registerName": register_name,
                "memberCount": len(members),
                "totalOptionCount": total_option_count,
                "completeCount": len(complete_members),
                "partialCount": len(partial_members),
                "missingCount": len(missing_members),
                "trafficLight": traffic_light,
                "completeMembers": complete_members,
                "partialMembers": partial_members,
                "missingMembers": missing_members,
            }
        )

    severity_order = {"red": 0, "yellow": 1, "green": 2}
    register_summary.sort(
        key=lambda item: (
            severity_order.get(item["trafficLight"], 99),
            item["registerName"].lower(),
        )
    )

    total_members = sum(item["memberCount"] for item in register_summary)
    total_complete = sum(item["completeCount"] for item in register_summary)
    total_partial = sum(item["partialCount"] for item in register_summary)
    total_missing = sum(item["missingCount"] for item in register_summary)

    return {
        "pollId": poll_id,
        "summary": {
            "memberCount": total_members,
            "completeCount": total_complete,
            "partialCount": total_partial,
            "missingCount": total_missing,
        },
        "registers": register_summary,
    }


@app.post("/polls/{poll_id}/comment")
def save_poll_comment(poll_id: str, payload: PollCommentPayload, request: Request):
    session = get_current_session(request)
    client = build_client_from_session(session)

    comment_text = (payload.comment or "").strip()
    if not comment_text:
        raise HTTPException(status_code=400, detail="Kommentar ist leer")

    try:
        client.add_poll_comment(poll_id, comment_text)
    except NextcloudApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return {"success": True}

@app.get("/users/search")
def search_users(q: str, request: Request):
    session = get_current_session(request)
    client = build_client_from_session(session)

    try:
        return client.search_users(q)
    except NextcloudApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

@app.post("/polls/{poll_id}/transfer-ownership")
def transfer_poll_ownership(
    poll_id: str,
    payload: dict[str, str],
    request: Request,
):
    session = get_current_session(request)
    client = build_client_from_session(session)

    new_owner_id = str(payload.get("newOwnerId", "")).strip()
    if not new_owner_id:
        raise HTTPException(status_code=400, detail="newOwnerId fehlt")

    try:
        raw_poll_response = client.get_poll(poll_id)
    except NextcloudApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    poll_data = raw_poll_response.get("poll", raw_poll_response)
    owner_id = extract_owner_id(poll_data)
    is_owner = bool(owner_id) and owner_id == str(session.user_id).strip()

    if not is_owner:
        raise HTTPException(
            status_code=403,
            detail="Nur der Eigentümer darf die Eigentümerschaft übertragen",
        )

    if new_owner_id == str(session.user_id).strip():
        raise HTTPException(
            status_code=400,
            detail="Die Eigentümerschaft kann nicht auf denselben Benutzer übertragen werden",
        )

    try:
        client.transfer_poll_ownership(poll_id, new_owner_id)
    except NextcloudApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return {
        "ok": True,
        "poll": get_poll_by_id(poll_id, request),
    }

@app.get("/calendars")
def get_calendars(request: Request):
    session = get_current_session(request)
    client = build_client_from_session(session)

    try:
        return client.get_writable_calendars()
    except NextcloudApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

@app.post("/polls/{poll_id}/calendar-events")
def create_poll_calendar_events(
    poll_id: str,
    payload: CalendarEventsPayload,
    request: Request,
):
    session = get_current_session(request)
    client = build_client_from_session(session)

    calendar_uri = payload.calendarUri.strip()
    title = payload.title.strip()
    description = payload.description.strip()
    location = payload.location.strip()
    option_selections = payload.optionSelections
    all_day = payload.allDay
    start_time = (payload.startTime or "").strip()
    end_time = (payload.endTime or "").strip()
    poll_app_url = payload.pollAppUrl.strip()

    if not calendar_uri:
        raise HTTPException(status_code=400, detail="calendarUri fehlt")

    if not option_selections:
        raise HTTPException(status_code=400, detail="Es wurde keine Option ausgewählt")

    try:
        raw_poll_response = client.get_poll(poll_id)
        raw_options = client.get_poll_options(poll_id)
    except NextcloudApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    poll_data = raw_poll_response.get("poll", raw_poll_response)
    owner_id = extract_owner_id(poll_data)
    

    poll_detail = get_poll_by_id(poll_id, request)

    if not poll_detail.get("permissions", {}).get("isPollAdmin", False):
        raise HTTPException(
            status_code=403,
            detail="Nur Eigentümer oder Co-Autoren dürfen Kalendereinträge erzeugen.",
        )

    selection_map = {
        str(item.optionId): (item.entryStatus or "inquiry").strip().lower()
        for item in option_selections
    }

    selected_options = [
        option for option in raw_options
        if str(option.get("id")) in selection_map
    ]

    if not selected_options:
        raise HTTPException(status_code=400, detail="Keine gültigen Optionen ausgewählt")

    poll_title = (
        poll_data.get("configuration", {}).get("title")
        or poll_data.get("title")
        or "Umfragetermin"
    )
    final_title = title or poll_title

    created_count = 0

    try:
        for option in selected_options:
            option_id = str(option.get("id"))
            option_timestamp = option.get("timestamp")

            if not isinstance(option_timestamp, (int, float)) or option_timestamp <= 0:
                continue

            option_label = str(option.get("text") or "").strip()
            entry_status = selection_map.get(option_id, "inquiry")

            client.create_calendar_event(
                poll_id=poll_id,
                calendar_uri=calendar_uri,
                summary=build_calendar_summary(final_title, entry_status),
                description=description,
                location=location,
                option_timestamp=int(option_timestamp),
                option_label=option_label,
                all_day=all_day,
                start_time=start_time if not all_day else "",
                end_time=end_time if not all_day else "",
                poll_app_url=poll_app_url,
                entry_status=entry_status,
            )
            created_count += 1

    except NextcloudApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return {
        "ok": True,
        "createdCount": created_count,
    }

@app.post("/polls")
def create_poll(payload: CreatePollPayload, request: Request):
    session = get_current_session(request)
    client = build_client_from_session(session)

    title = payload.title.strip()
    description = payload.description.strip()
    options = payload.options
    allow_maybe = payload.allowMaybe

    if not title:
        raise HTTPException(status_code=400, detail="Titel fehlt")

    if not options:
        raise HTTPException(status_code=400, detail="Mindestens eine Option ist erforderlich")

    try:
        result = client.create_date_poll(
            title=title,
            description=description,
            options=options,
            allow_maybe=allow_maybe,
            share_group_ids=payload.shareGroupIds,
        )
    except NextcloudApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    poll_id = str(result.get("id") or result.get("pollId") or "")

    return {
        "ok": True,
        "pollId": poll_id,
    }

@app.put("/polls/shares/{share_token}/admin")
def set_poll_share_admin(share_token: str, request: Request):
    session = get_current_session(request)
    client = build_client_from_session(session)

    try:
        return client.set_poll_share_admin(share_token)
    except NextcloudApiError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Co-Autor konnte nicht hinzugefügt werden: {type(exc).__name__}: {exc}",
        ) from exc

@app.delete("/polls/shares/{share_token}/admin")
def remove_poll_share_admin(share_token: str, request: Request):
    session = get_current_session(request)
    client = build_client_from_session(session)

    try:
        client.remove_poll_share_admin(share_token)
        return client.delete_poll_share(share_token)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Co-Autor konnte nicht entfernt werden: {type(exc).__name__}: {exc}",
        ) from exc

@app.post("/polls/{poll_id}/shares")
def create_poll_share(poll_id: str, payload: dict, request: Request):
    session = get_current_session(request)
    client = build_client_from_session(session)

    user_id = str(payload.get("userId") or "").strip()

    if not user_id:
        raise HTTPException(status_code=400, detail="userId fehlt.")

    try:
        return client.create_poll_share(poll_id, user_id)
    except NextcloudApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

@app.get("/groups")
def list_share_groups(request: Request):
    get_current_session(request)

    groups = [
        {
            "id": group["groupId"],
            "displayName": group["displayName"],
        }
        for group in REGISTER_GROUPS
        if group.get("groupId")
    ]

    return {"groups": groups}