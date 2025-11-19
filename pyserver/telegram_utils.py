from __future__ import annotations

import hmac
import json
import os
from hashlib import sha256
from typing import Any, Dict, Optional
from urllib.parse import parse_qsl


def _bot_token() -> str:
    return os.getenv("TELEGRAM_BOT_TOKEN") or os.getenv("BOT_TOKEN") or ""


def validate_telegram_webapp_data(init_data: str) -> bool:
    if not init_data:
        return False

    params = dict(parse_qsl(init_data, keep_blank_values=True))
    hash_value = params.pop("hash", None)
    if not hash_value:
        return False

    data_check_string = "\n".join(
        f"{key}={value}" for key, value in sorted(params.items(), key=lambda item: item[0])
    )

    bot = _bot_token()
    if not bot:
        return False

    secret = hmac.new(b"WebAppData", bot.encode(), sha256).digest()
    calculated = hmac.new(secret, data_check_string.encode(), sha256).hexdigest()
    return calculated == hash_value


def extract_user_data(init_data: str) -> Optional[Dict[str, Any]]:
    if not validate_telegram_webapp_data(init_data):
        return None

    params = dict(parse_qsl(init_data, keep_blank_values=True))
    user_payload = params.get("user")
    if not user_payload:
        return None

    try:
        user = json.loads(user_payload)
    except json.JSONDecodeError:
        return None

    return {
        "id": user.get("id"),
        "first_name": user.get("first_name"),
        "last_name": user.get("last_name"),
        "username": user.get("username"),
        "photo_url": user.get("photo_url"),
        "is_bot": user.get("is_bot"),
    }
