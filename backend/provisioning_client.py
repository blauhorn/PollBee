from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import requests


class ProvisioningApiError(Exception):
    pass


@dataclass
class ProvisioningCredentials:
    base_url: str
    username: str
    app_password: str


class ProvisioningClient:
    def __init__(self, credentials: ProvisioningCredentials) -> None:
        self.base_url = credentials.base_url.rstrip("/")
        self.username = credentials.username
        self.app_password = credentials.app_password

    def _request(self, method: str, path: str) -> requests.Response:
        url = f"{self.base_url}{path}"
        response = requests.request(
            method=method,
            url=url,
            auth=(self.username, self.app_password),
            headers={
                "OCS-APIRequest": "true",
                "Accept": "application/json",
            },
            timeout=20,
        )
        return response

    def get_group_members(self, group_name: str) -> list[str]:
        response = self._request("GET", f"/ocs/v1.php/cloud/groups/{group_name}")
        if response.status_code != 200:
            raise ProvisioningApiError(
                f"Group member lookup failed for {group_name}: {response.status_code}"
            )

        data = response.json()
        meta = data.get("ocs", {}).get("meta", {})
        if meta.get("statuscode") != 100:
            raise ProvisioningApiError(f"Provisioning API error for {group_name}: {meta}")

        return data.get("ocs", {}).get("data", {}).get("users", [])
