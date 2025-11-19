from __future__ import annotations

import re
from typing import Optional


USERNAME_RE = re.compile(r"[^a-zA-Z0-9_]+")


def sanitize_string(value: Optional[str], limit: int = 100) -> str:
    if not value:
        return ""
    return value.replace("<", "").replace(">", "").strip()[:limit]


def sanitize_username(value: Optional[str]) -> str:
    if not value:
        return ""
    username = value.strip().lstrip("@")
    username = USERNAME_RE.sub("", username)
    return username[:32]


def is_numeric_id(value: Optional[str | int]) -> bool:
    if value is None:
        return False
    if isinstance(value, int):
        return True
    if isinstance(value, str):
        return value.isdigit()
    return False
