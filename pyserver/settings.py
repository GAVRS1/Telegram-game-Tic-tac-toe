from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
import os
from pathlib import Path
from typing import Optional


@dataclass(slots=True)
class Settings:
    port: int = int(os.getenv("PORT", "8080"))
    public_url: str = os.getenv("PUBLIC_URL", "").strip()
    public_dir: Path = Path(__file__).resolve().parent.parent / "public"

    database_url: str = os.getenv("DATABASE_URL", "").strip()
    pg_host: str = os.getenv("PGHOST", "").strip()
    pg_port: int = int(os.getenv("PGPORT", "5432") or 5432)
    pg_user: str = os.getenv("PGUSER", "").strip()
    pg_password: str = os.getenv("PGPASSWORD", "").strip()
    pg_database: str = os.getenv("PGDATABASE", "").strip()
    pg_ssl: str = os.getenv("PGSSL", "").strip()
    pg_pool_min_size: int = int(os.getenv("PGPOOL_MIN_SIZE", "1") or 1)
    pg_pool_max_size: int = int(os.getenv("PGPOOL_MAX_SIZE", "10") or 10)

    bot_token: str = os.getenv("TELEGRAM_BOT_TOKEN", os.getenv("BOT_TOKEN", "")).strip()
    skip_bot: bool = os.getenv("SKIP_BOT", "0").strip() in {"1", "true", "TRUE", "yes", "on"}

    heartbeat_interval: float = float(os.getenv("WS_HEARTBEAT_INTERVAL", "30"))
    heartbeat_timeout: float = float(os.getenv("WS_HEARTBEAT_TIMEOUT", "12"))

    @property
    def has_database(self) -> bool:
        return bool(self.database_url or self.pg_host)

    def pg_ssl_config(self) -> Optional[str]:
        value = self.pg_ssl.lower()
        return value or None


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
