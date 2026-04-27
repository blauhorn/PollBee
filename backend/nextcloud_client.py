from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import requests
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from uuid import uuid4

class NextcloudApiError(Exception):
    pass


@dataclass
class NextcloudCredentials:
    base_url: str
    username: str
    app_password: str


class NextcloudClient:
    
    def __init__(self, credentials: NextcloudCredentials) -> None:
        self.base_url = credentials.base_url.rstrip("/")
        self.username = credentials.username
        self.app_password = credentials.app_password

    def _request(
        self,
        method: str,
        path: str,
        *,
        headers: dict[str, str] | None = None,
        params: dict[str, Any] | None = None,
        json_data: dict[str, Any] | None = None,
    ) -> requests.Response:
        request_headers = {
            "OCS-APIRequest": "true",
            "Accept": "application/json",
        }
        if headers:
            request_headers.update(headers)

        url = f"{self.base_url}{path}"

        response = requests.request(
            method=method,
            url=url,
            auth=(self.username, self.app_password),
            headers=request_headers,
            params=params,
            json=json_data,
            timeout=20,
        )
        return response

    def validate_credentials(self) -> dict[str, Any]:
        response = self._request("GET", "/ocs/v1.php/cloud/user")
        if response.status_code != 200:
            raise NextcloudApiError(
                f"Credential validation failed with status {response.status_code}"
            )

        data = response.json()
        meta = data.get("ocs", {}).get("meta", {})
        if meta.get("statuscode") != 100:
            raise NextcloudApiError(f"OCS auth failed: {meta}")

        user_data = data.get("ocs", {}).get("data", {})
        return user_data

    def _polls_headers(self) -> dict:
        return {
            "Accept": "application/json",
            "X-Requested-With": "XMLHttpRequest",
            "NC-Polls-Client-Id": "pollbee",
            "NC-Polls-Client-Time-Zone": "Europe/Berlin",
        }

    def set_poll_share_admin(self, share_token: str) -> dict[str, Any]:
        return self._request(
            "PUT",
            f"/apps/polls/share/{share_token}/admin",
            headers={
                "Accept": "application/json",
                "X-Requested-With": "XMLHttpRequest",
                "NC-Polls-Client-Id": "pollbee",
                "NC-Polls-Client-Time-Zone": "Europe/Berlin",
            },
        )   
    def remove_poll_share_admin(self, share_token: str) -> dict[str, Any]:
        return self._request(
            "PUT",
            f"/apps/polls/share/{share_token}/admin",
            headers={
                "Accept": "application/json",
                "X-Requested-With": "XMLHttpRequest",
                "NC-Polls-Client-Id": "pollbee",
                "NC-Polls-Client-Time-Zone": "Europe/Berlin",
            },
        )

    def get_polls(self) -> list[dict[str, Any]]:
        response = self._request("GET", "/apps/polls/polls")
        if response.status_code != 200:
            raise NextcloudApiError(f"Poll list failed with status {response.status_code}")

        data = response.json()
        return data.get("polls", [])

    def get_poll(self, poll_id: str) -> dict[str, Any]:
        response = self._request("GET", f"/apps/polls/poll/{poll_id}")
        if response.status_code != 200:
            raise NextcloudApiError(f"Poll detail failed with status {response.status_code}")
        return response.json()

    def get_poll_options(self, poll_id: str) -> list[dict[str, Any]]:
        response = self._request("GET", f"/apps/polls/poll/{poll_id}/options")
        if response.status_code != 200:
            raise NextcloudApiError(
                f"Poll options failed with status {response.status_code}"
            )
        return response.json().get("options", [])

    def get_poll_votes(self, poll_id: str) -> list[dict[str, Any]]:
        response = self._request("GET", f"/apps/polls/poll/{poll_id}/votes")
        if response.status_code != 200:
            raise NextcloudApiError(f"Poll votes failed with status {response.status_code}")
        return response.json().get("votes", [])

    def close_poll(self, poll_id: str) -> dict[str, Any]:
       response = self._request(
           "PUT",
           f"/apps/polls/poll/{poll_id}/close",
           headers={
               "Accept": "application/json",
               "X-Requested-With": "XMLHttpRequest",
               "NC-Polls-Client-Id": "pollbee",
               "NC-Polls-Client-Time-Zone": "Europe/Berlin",
           },
       )

       print(
           "DEBUG nextcloud close_poll response:",
           {
               "status_code": response.status_code,
               "text": response.text,
               "headers": dict(response.headers),
           },
       )

       if response.status_code not in (200, 201):
           raise NextcloudApiError(
               f"Close poll failed with status {response.status_code}: {response.text}"
           )

       if response.content:
           try:
               return response.json()
           except ValueError:
               return {"success": True, "raw": response.text}

       return {"success": True}

    def reopen_poll(self, poll_id: str) -> dict[str, Any]:
        response = self._request(
            "PUT",
            f"/apps/polls/poll/{poll_id}/reopen",
            headers={
                "Accept": "application/json",
                "X-Requested-With": "XMLHttpRequest",
                "NC-Polls-Client-Id": "pollbee",
                "NC-Polls-Client-Time-Zone": "Europe/Berlin",
            },
        )

        print(
            "DEBUG nextcloud reopen_poll response:",
            {
                "status_code": response.status_code,
                "text": response.text,
                "headers": dict(response.headers),
            },
        )

        if response.status_code not in (200, 201):
            raise NextcloudApiError(
                f"Reopen poll failed with status {response.status_code}: {response.text}"
            )

        if response.content:
            try:
                return response.json()
            except ValueError:
                return {"success": True, "raw": response.text}

        return {"success": True}

 
    def submit_vote(
        self,
        poll_id: str,
        option_id: str,
        value: str,
    ) -> dict[str, Any]:
        normalized_value = str(value).strip().lower()

        if normalized_value not in {"yes", "no", "maybe"}:
            raise NextcloudApiError(f"Unsupported vote value: {value}")

        response = self._request(
            "PUT",
            "/apps/polls/vote",
            json_data={
                "pollId": int(poll_id),
                "optionId": int(option_id),
                "setTo": normalized_value,
            },
        )

        print(
            "DEBUG nextcloud submit_vote response:",
            {
                "status_code": response.status_code,
                "text": response.text,
                "headers": dict(response.headers),
            },
        )

        if response.status_code not in (200, 201):
            raise NextcloudApiError(
                f"Vote submit failed with status {response.status_code}: {response.text}"
            )

        if response.content:
            return response.json()
        return {"success": True}

    def add_poll_comment(self, poll_id: str, comment: str) -> dict[str, Any]:
        comment_text = str(comment).strip()
        if not comment_text:
            raise NextcloudApiError("Comment must not be empty")

        response = self._request(
            "POST",
            f"/apps/polls/poll/{poll_id}/comment",
            params={
                "time": int(__import__("time").time() * 1000),
            },
            headers={
                "Content-Type": "application/json",
                "X-Requested-With": "XMLHttpRequest",
                "NC-Polls-Client-Time-Zone": "Europe/Berlin",
                "NC-Polls-Client-Id": "pollbee",
            },
            json_data={
                "comment": comment_text,
                "confidential": False,
            },
        )

        print(
            "DEBUG nextcloud add_poll_comment response:",
            {
                "status_code": response.status_code,
                "text": response.text,
                "headers": dict(response.headers),
            },
        )

        if response.status_code not in (200, 201):
            raise NextcloudApiError(
                f"Comment submit failed with status {response.status_code}: {response.text}"
            )

        if response.content:
            try:
                return response.json()
            except ValueError:
                return {"success": True, "raw": response.text}

        return {"success": True}

    def search_users(self, query: str) -> list[dict[str, Any]]:
        search_term = str(query).strip()
        if not search_term:
            return []

        response = self._request(
            "GET",
            "/ocs/v1.php/cloud/users",
            params={
                "search": search_term,
            },
        )

        if response.status_code != 200:
            raise NextcloudApiError(
                f"User search failed with status {response.status_code}: {response.text}"
            )

        data = response.json()
        users = data.get("ocs", {}).get("data", {}).get("users", [])

        results = []
        for user_id in users:
            if not user_id:
                continue
            results.append(
                {
                    "id": str(user_id),
                    "displayName": str(user_id),
                }
            )

        return results

    def transfer_poll_ownership(self, poll_id: str, new_owner_id: str) -> dict[str, Any]:
        response = self._request(
            "PUT",
            f"/apps/polls/poll/{poll_id}/changeowner/{new_owner_id}",
            headers={
                "Accept": "application/json",
                "X-Requested-With": "XMLHttpRequest",
                "NC-Polls-Client-Id": "pollbee",
                "NC-Polls-Client-Time-Zone": "Europe/Berlin",
            },
        )

        print(
            "DEBUG nextcloud transfer_poll_ownership response:",
            {
                "status_code": response.status_code,
                "text": response.text,
                "headers": dict(response.headers),
            },
        )

        if response.status_code not in (200, 201):
            raise NextcloudApiError(
                f"Transfer ownership failed with status {response.status_code}: {response.text}"
            )

        if response.content:
            try:
                return response.json()
            except ValueError:
                return {"success": True, "raw": response.text}

        return {"success": True}
    
    def get_writable_calendars(self) -> list[dict[str, Any]]:
        url = f"{self.base_url}/remote.php/dav/calendars/{self.username}/"

        headers = {
            "Depth": "1",
            "Content-Type": "application/xml; charset=utf-8",
            "Accept": "application/xml, text/xml",
        }

        body = """<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/" xmlns:oc="http://owncloud.org/ns/">
  <d:prop>
    <d:displayname />
    <d:resourcetype />
    <cs:getctag />
    <oc:calendar-enabled />
  </d:prop>
</d:propfind>
"""

        response = requests.request(
            method="PROPFIND",
            url=url,
            auth=(self.username, self.app_password),
            headers=headers,
            data=body.encode("utf-8"),
            timeout=20,
        )

        print(
            "DEBUG nextcloud get_writable_calendars response:",
            {
                "status_code": response.status_code,
                "text": response.text[:2000],
                "headers": dict(response.headers),
            },
        )

        if response.status_code not in (200, 207):
            raise NextcloudApiError(
                f"Calendar discovery failed with status {response.status_code}: {response.text}"
            )

        try:
            root = ET.fromstring(response.text)
        except ET.ParseError as exc:
            raise NextcloudApiError(f"Calendar discovery returned invalid XML: {exc}") from exc

        ns = {
            "d": "DAV:",
            "cal": "urn:ietf:params:xml:ns:caldav",
            "cs": "http://calendarserver.org/ns/",
            "oc": "http://owncloud.org/ns/",
        }

        calendars: list[dict[str, Any]] = []

        for response_node in root.findall("d:response", ns):
            href = response_node.findtext("d:href", default="", namespaces=ns).strip()
            if not href:
                continue

            if href.rstrip("/").endswith(f"/calendars/{self.username}"):
                continue

            display_name = ""
            enabled = True
            is_calendar = False

            for propstat in response_node.findall("d:propstat", ns):
                status_text = propstat.findtext("d:status", default="", namespaces=ns)
                if "200" not in status_text:
                    continue

                prop = propstat.find("d:prop", ns)
                if prop is None:
                    continue

                resource_type = prop.find("d:resourcetype", ns)
                if resource_type is not None and resource_type.find("cal:calendar", ns) is not None:
                    is_calendar = True

                display_name = (
                    prop.findtext("d:displayname", default="", namespaces=ns).strip()
                    or display_name
                )

                enabled_text = prop.findtext("oc:calendar-enabled", default="", namespaces=ns).strip()
                if enabled_text:
                    enabled = enabled_text not in {"0", "false", "False"}

            if not is_calendar or not enabled:
                continue

            uri = href.rstrip("/").split("/")[-1]
            calendars.append(
                {
                    "id": uri,
                    "uri": uri,
                    "displayName": display_name or uri,
                    "owner": self.username,
                }
            )

        return calendars

    def create_calendar_event(
        self,
        *,
        poll_id: str,
        calendar_uri: str,
        summary: str,
        description: str,
        location: str,
        option_timestamp: int,
        option_label: str,
        all_day: bool,
        start_time: str,
        end_time: str,
        poll_app_url: str,
        entry_status: str,
    ) -> dict[str, Any]:
        base_dt = datetime.fromtimestamp(option_timestamp)

        uid = f"{poll_id}-{option_timestamp}-{calendar_uri}@pollbee"
        dtstamp = self._format_utc(datetime.now(timezone.utc))

        escaped_summary = self._escape_ical_text(summary)
        escaped_description = self._escape_ical_text(description)
        escaped_location = self._escape_ical_text(location)
        escaped_option_label = self._escape_ical_text(option_label)
        poll_url = f"{self.base_url}/apps/polls/vote/{poll_id}"
        extra_parts: list[str] = []

        status_map = {
            "inquiry": "ANFRAGE",
            "fixed": "FIX",
            "canceled": "CANCELED",
        }

        status_label = status_map.get(entry_status, "ANFRAGE")
        extra_parts.append(f"Status: {status_label}")

        if escaped_description:
            extra_parts.append(escaped_description)

        if escaped_option_label:
            extra_parts.append(f"Umfrageoption: {escaped_option_label}")

        if poll_app_url:
            extra_parts.append(f"Umfrage: {self._escape_ical_text(poll_app_url)}")

        extra_description = "\\n\\n".join(extra_parts)

        if all_day:
            start_date = base_dt.strftime("%Y%m%d")
            end_date = (base_dt + timedelta(days=1)).strftime("%Y%m%d")

            ics = (
                "BEGIN:VCALENDAR\r\n"
                "VERSION:2.0\r\n"
                "PRODID:-//PollBee//Nextcloud Poll Export//DE\r\n"
                "BEGIN:VEVENT\r\n"
                f"UID:{uid}\r\n"
                f"DTSTAMP:{dtstamp}\r\n"
                f"DTSTART;VALUE=DATE:{start_date}\r\n"
                f"DTEND;VALUE=DATE:{end_date}\r\n"
                f"SUMMARY:{escaped_summary}\r\n"
                f"DESCRIPTION:{extra_description}\r\n"
                f"LOCATION:{escaped_location}\r\n"
                "END:VEVENT\r\n"
                "END:VCALENDAR\r\n"
            )
        else:
            start_hour, start_minute = self._parse_time_string(start_time, 19, 30)
            end_hour, end_minute = self._parse_time_string(end_time, 22, 0)

            start_dt = base_dt.replace(
                hour=start_hour,
                minute=start_minute,
                second=0,
                microsecond=0,
            )
            end_dt = base_dt.replace(
                hour=end_hour,
                minute=end_minute,
                second=0,
                microsecond=0,
            )

            if end_dt <= start_dt:
                end_dt = start_dt + timedelta(hours=2)

            dtstart = self._format_local(start_dt)
            dtend = self._format_local(end_dt)

            ics = (
                "BEGIN:VCALENDAR\r\n"
                "VERSION:2.0\r\n"
                "PRODID:-//PollBee//Nextcloud Poll Export//DE\r\n"
                "BEGIN:VEVENT\r\n"
                f"UID:{uid}\r\n"
                f"DTSTAMP:{dtstamp}\r\n"
                f"DTSTART:{dtstart}\r\n"
                f"DTEND:{dtend}\r\n"
                f"SUMMARY:{escaped_summary}\r\n"
                f"DESCRIPTION:{extra_description}\r\n"
                f"LOCATION:{escaped_location}\r\n"
                "END:VEVENT\r\n"
                "END:VCALENDAR\r\n"
            )

        event_path = f"/remote.php/dav/calendars/{self.username}/{calendar_uri}/{uid}.ics"
        url = f"{self.base_url}{event_path}"

        response = requests.put(
            url=url,
            auth=(self.username, self.app_password),
            headers={
                "Content-Type": "text/calendar; charset=utf-8",
                "Accept": "application/json, text/plain, */*",
            },
            data=ics.encode("utf-8"),
            timeout=20,
        )

        print(
            "DEBUG nextcloud create_calendar_event response:",
            {
                "status_code": response.status_code,
                "url": url,
                "text": response.text[:1000],
                "headers": dict(response.headers),
            },
        )

        if response.status_code not in (200, 201, 204):
            raise NextcloudApiError(
                f"Calendar event create failed with status {response.status_code}: {response.text}"
            )

        if response.content:
            try:
                return response.json()
            except ValueError:
                return {"success": True, "raw": response.text}

        return {"success": True}

    def create_date_poll(
        self,
        *,
        title: str,
        description: str,
        options: list[Any],
        allow_maybe: bool,
    ) -> dict[str, Any]:

        response = self._request(
            "POST",
            "/apps/polls/poll/add",
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json",
                "X-Requested-With": "XMLHttpRequest",
                "NC-Polls-Client-Id": "pollbee",
                "NC-Polls-Client-Time-Zone": "Europe/Berlin",
            },
            json_data={
                "type": "datePoll",
                "title": title,
                "timezoneName": "Europe/Berlin",
            },
        )

        if response.status_code not in (200, 201):
            raise NextcloudApiError(
                f"Create poll failed: {response.status_code} {response.text}"
            )

        data = response.json()
        poll_data = data.get("poll", data)

        poll_id_raw = (
            poll_data.get("id")
            or data.get("pollId")
            or data.get("id")
        )

        poll_id = str(poll_id_raw) if poll_id_raw is not None else ""

        if not poll_id:
            raise NextcloudApiError(f"Poll ID missing in response: {data}")

        berlin = ZoneInfo("Europe/Berlin")

        for option in options:
            timestamp = int(option.timestamp)

            # Wichtig: explizit Europe/Berlin
            dt = datetime.fromtimestamp(timestamp, tz=berlin)

            # Für datePoll besser auf Tagesanfang normieren
            dt = dt.replace(hour=0, minute=0, second=0, microsecond=0)

            iso_timestamp = dt.isoformat()

            option_payload = {
                "option": {
                    "text": "",
                    "isoTimestamp": iso_timestamp,
                    "isoDuration": "P1D",
                },
                "sequence": {
                    "unit": {
                        "id": "week",
                        "name": "Woche",
                        "timeOption": False,
                    },
                    "stepWidth": 1,
                    "repetitions": 0,
                },
                "voteYes": True,
            }

            print(
                "DEBUG nextcloud add option payload:",
                {
                    "poll_id": poll_id,
                    "payload": option_payload,
                },
            )

            option_response = self._request(
                "POST",
                f"/apps/polls/poll/{poll_id}/option",
                headers={
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                    "X-Requested-With": "XMLHttpRequest",
                    "NC-Polls-Client-Id": "pollbee",
                    "NC-Polls-Client-Time-Zone": "Europe/Berlin",
                },
                json_data=option_payload,
            )

            print(
                "DEBUG nextcloud add option response:",
                {
                    "status_code": option_response.status_code,
                    "text": option_response.text[:1000],
                    "headers": dict(option_response.headers),
                },
            )

            if option_response.status_code not in (200, 201):
                raise NextcloudApiError(
                    f"Add option failed: {option_response.status_code} {option_response.text}"
                )

        if description:
            self.update_poll_description(
                poll_id=poll_id,
                title=title,
                description=description,
                allow_maybe=allow_maybe,
            )

        return {"pollId": poll_id}

    def update_poll_description(
        self,
        *,
        poll_id: str,
        title: str,
        description: str,
        allow_maybe: bool,
    ) -> None:

        response = self._request(
            "PUT",
            f"/apps/polls/poll/{poll_id}",
            headers={
                "Accept": "application/json",
                "X-Requested-With": "XMLHttpRequest",
                "NC-Polls-Client-Id": "pollbee",
                "NC-Polls-Client-Time-Zone": "Europe/Berlin",
            },
            json_data={
                "poll": {
                    "title": title,
                    "description": description,
                    "access": "private",
                    "allowComment": True,
                    "allowMaybe": allow_maybe,
                    "allowProposals": "disallow",
                    "anonymous": False,
                    "autoReminder": False,
                    "collapseDescription": True,
                    "expire": 0,
                    "allowDownload": True,
                    "forceConfidentialComments": False,
                    "forcedDisplayMode": "user-pref",
                    "hideBookedUp": True,
                    "proposalsExpire": 0,
                    "showResults": "always",
                    "useNo": True,
                    "maxVotesPerOption": 0,
                    "maxVotesPerUser": 0,
                    "timezoneName": "Europe/Berlin",
                }
            },
        )

        if response.status_code not in (200, 201):
            raise NextcloudApiError(
                f"Update poll failed: {response.status_code} {response.text}"
            )

    @staticmethod
    def start_login_flow_v2(base_url: str) -> dict[str, Any]:
        normalized_base_url = base_url.rstrip("/")
        try:
            response = requests.post(
                f"{normalized_base_url}/index.php/login/v2",
                timeout=20,
                headers={
                    "Accept": "application/json",
                    "User-Agent": "NTSO PollApp Browser",
                },
            )
        except requests.RequestException as exc:
            raise NextcloudApiError(f"Login flow start failed: {exc}") from exc

        if response.status_code != 200:
            raise NextcloudApiError(
                f"Login flow start failed with status {response.status_code}: {response.text}"
            )

        try:
            return response.json()
        except ValueError as exc:
            raise NextcloudApiError("Login flow start returned invalid JSON") from exc

    @staticmethod
    def poll_login_flow_v2(poll_endpoint: str, token: str) -> dict[str, Any] | None:
        try:
            response = requests.post(
                poll_endpoint,
                timeout=20,
                headers={
                    "Accept": "application/json",
                    "User-Agent": "NTSO PollApp Browser",
                },
                data={
                    "token": token,
                },
            )
        except requests.RequestException as exc:
            raise NextcloudApiError(f"Login flow polling failed: {exc}") from exc

        if response.status_code == 404:
            return None

        if response.status_code != 200:
            raise NextcloudApiError(
                f"Login flow polling failed with status {response.status_code}: {response.text}"
            )

        try:
            return response.json()
        except ValueError as exc:
            raise NextcloudApiError("Login flow polling returned invalid JSON") from exc
        
    @staticmethod
    def _escape_ical_text(value: str) -> str:
        return (
            str(value or "")
            .replace("\\", "\\\\")
            .replace("\n", "\\n")
            .replace(",", "\\,")
            .replace(";", "\\;")
        )

    @staticmethod
    def _format_utc(dt: datetime) -> str:
        return dt.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

    @staticmethod
    def _format_local(dt: datetime) -> str:
        return dt.strftime("%Y%m%dT%H%M%S")

    @staticmethod
    def _parse_time_string(value: str, fallback_hour: int, fallback_minute: int) -> tuple[int, int]:
        text = str(value or "").strip()
        if not text:
            return fallback_hour, fallback_minute

        try:
            hour_str, minute_str = text.split(":", 1)
            hour = int(hour_str)
            minute = int(minute_str)
            if 0 <= hour <= 23 and 0 <= minute <= 59:
                return hour, minute
        except Exception:
            pass

        return fallback_hour, fallback_minute
    
    def create_poll_share(self, poll_id: str, user_id: str):
        return self._request(
            "POST",
            "/apps/polls/share",
            json_data={
                "pollId": poll_id,
                "type": "user",
                "userId": user_id,
            },
            headers={
                "Accept": "application/json",
                "X-Requested-With": "XMLHttpRequest",
                "NC-Polls-Client-Id": "pollbee",
                "NC-Polls-Client-Time-Zone": "Europe/Berlin",
            },
        ).json()
    
