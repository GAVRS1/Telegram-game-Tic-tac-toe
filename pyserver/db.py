from __future__ import annotations

import asyncio
import json
import ssl
from typing import Any, Dict, List, Optional

import asyncpg

from .achievements import ACHIEVEMENTS, evaluate_achievement
from .settings import get_settings
from .utils import is_numeric_id

_pool: Optional[asyncpg.Pool] = None
_pool_lock = asyncio.Lock()


async def get_pool() -> Optional[asyncpg.Pool]:
    global _pool
    if _pool:
        return _pool

    async with _pool_lock:
        if _pool:
            return _pool

        settings = get_settings()
        if not settings.has_database:
            return None

        pool_config: Dict[str, Any] = {
            "min_size": max(1, settings.pg_pool_min_size),
            "max_size": max(settings.pg_pool_min_size, settings.pg_pool_max_size),
        }
        if settings.database_url:
            pool_config["dsn"] = settings.database_url
        else:
            if not settings.pg_host:
                return None
            pool_config.update(
                host=settings.pg_host,
                port=settings.pg_port,
            )
            if settings.pg_user:
                pool_config["user"] = settings.pg_user
            if settings.pg_password:
                pool_config["password"] = settings.pg_password
            if settings.pg_database:
                pool_config["database"] = settings.pg_database

        ssl_value = (settings.pg_ssl or "").strip().lower()
        if ssl_value in {"1", "true", "require"}:
            context = ssl.create_default_context()
            context.check_hostname = False
            context.verify_mode = ssl.CERT_NONE
            pool_config["ssl"] = context

        _pool = await asyncpg.create_pool(**pool_config)
        return _pool


async def close_pool() -> None:
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


async def ensure_schema() -> bool:
    pool = await get_pool()
    if not pool:
        return False

    async with pool.acquire() as conn:
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
              id            BIGINT PRIMARY KEY,
              username      TEXT,
              avatar_url    TEXT,
              games_played  INTEGER NOT NULL DEFAULT 0,
              wins          INTEGER NOT NULL DEFAULT 0,
              losses        INTEGER NOT NULL DEFAULT 0,
              draws         INTEGER NOT NULL DEFAULT 0,
              created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        await conn.execute("CREATE INDEX IF NOT EXISTS idx_users_wins ON users (wins DESC, updated_at DESC);")
        await conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS games_played INTEGER NOT NULL DEFAULT 0;")
        await conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS losses INTEGER NOT NULL DEFAULT 0;")
        await conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS draws INTEGER NOT NULL DEFAULT 0;")

        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS achievements (
              id           TEXT PRIMARY KEY,
              name         TEXT NOT NULL,
              description  TEXT NOT NULL,
              metric       TEXT NOT NULL,
              target       NUMERIC NOT NULL,
              icon         TEXT DEFAULT '',
              order_index  INTEGER NOT NULL DEFAULT 0,
              extra        JSONB NOT NULL DEFAULT '{}'::jsonb,
              created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS user_achievements (
              user_id          BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              achievement_id   TEXT   NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
              progress_value   NUMERIC NOT NULL DEFAULT 0,
              progress_percent NUMERIC NOT NULL DEFAULT 0,
              unlocked         BOOLEAN NOT NULL DEFAULT FALSE,
              unlocked_at      TIMESTAMPTZ,
              details          JSONB NOT NULL DEFAULT '{}'::jsonb,
              updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              PRIMARY KEY (user_id, achievement_id)
            );
            """
        )
        await conn.execute("ALTER TABLE achievements ADD COLUMN IF NOT EXISTS icon TEXT DEFAULT '';")
        await conn.execute("ALTER TABLE achievements ADD COLUMN IF NOT EXISTS order_index INTEGER NOT NULL DEFAULT 0;")
        await conn.execute("ALTER TABLE achievements ADD COLUMN IF NOT EXISTS extra JSONB NOT NULL DEFAULT '{}'::jsonb;")
        await conn.execute("ALTER TABLE achievements ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();")
        await conn.execute("ALTER TABLE user_achievements ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '{}'::jsonb;")
        await conn.execute("ALTER TABLE user_achievements ADD COLUMN IF NOT EXISTS progress_value NUMERIC NOT NULL DEFAULT 0;")
        await conn.execute("ALTER TABLE user_achievements ADD COLUMN IF NOT EXISTS progress_percent NUMERIC NOT NULL DEFAULT 0;")
        await conn.execute("ALTER TABLE user_achievements ADD COLUMN IF NOT EXISTS unlocked BOOLEAN NOT NULL DEFAULT FALSE;")
        await conn.execute("ALTER TABLE user_achievements ADD COLUMN IF NOT EXISTS unlocked_at TIMESTAMPTZ;")

        await ensure_achievement_definitions(conn)
    return True


async def ensure_achievement_definitions(conn: asyncpg.Connection) -> None:
    for definition in ACHIEVEMENTS:
        await conn.execute(
            """
            INSERT INTO achievements (id, name, description, metric, target, icon, order_index, extra, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW())
            ON CONFLICT (id) DO UPDATE SET
              name = EXCLUDED.name,
              description = EXCLUDED.description,
              metric = EXCLUDED.metric,
              target = EXCLUDED.target,
              icon = EXCLUDED.icon,
              order_index = EXCLUDED.order_index,
              extra = EXCLUDED.extra,
              updated_at = NOW();
            """,
            definition.id,
            definition.name,
            definition.description,
            definition.metric,
            definition.target,
            definition.icon or "",
            definition.order,
            json.dumps(definition.extra or {}),
        )

    if ACHIEVEMENTS:
        await conn.execute(
            f"DELETE FROM achievements WHERE id NOT IN ({','.join(f'${i+1}' for i in range(len(ACHIEVEMENTS)))})",
            *[definition.id for definition in ACHIEVEMENTS],
        )


async def upsert_user(*, id: str | int, username: Optional[str], avatar_url: Optional[str]) -> None:
    if not is_numeric_id(id):
        return
    pool = await get_pool()
    if not pool:
        return

    numeric_id = int(id)
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO users (id, username, avatar_url)
            VALUES ($1, $2, $3)
            ON CONFLICT (id) DO UPDATE SET
              username = EXCLUDED.username,
              avatar_url = EXCLUDED.avatar_url,
              updated_at = NOW();
            """,
            numeric_id,
            username or None,
            avatar_url or None,
        )


async def _upsert_stats(id: str | int, *, games: int = 0, wins: int = 0, losses: int = 0, draws: int = 0) -> None:
    if not is_numeric_id(id):
        return
    pool = await get_pool()
    if not pool:
        return

    numeric_id = int(id)
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO users (id, games_played, wins, losses, draws)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (id) DO UPDATE SET
              games_played = users.games_played + EXCLUDED.games_played,
              wins = users.wins + EXCLUDED.wins,
              losses = users.losses + EXCLUDED.losses,
              draws = users.draws + EXCLUDED.draws,
              updated_at = NOW();
            """,
            numeric_id,
            games,
            wins,
            losses,
            draws,
        )


async def record_player_result(id: str | int, result: str) -> None:
    increments = {"games": 1, "wins": 0, "losses": 0, "draws": 0}
    if result == "win":
        increments["wins"] = 1
    elif result == "loss":
        increments["losses"] = 1
    elif result == "draw":
        increments["draws"] = 1

    await _upsert_stats(id, **increments)
    await refresh_user_achievements(id)


async def record_match_outcome(*, winner_id: Optional[str | int] = None, loser_id: Optional[str | int] = None, draw_ids: Optional[List[str | int]] = None) -> None:
    tasks = []
    if winner_id:
        tasks.append(record_player_result(winner_id, "win"))
    if loser_id:
        tasks.append(record_player_result(loser_id, "loss"))
    if draw_ids:
        unique_ids = {str(x) for x in draw_ids if is_numeric_id(x)}
        for uid in unique_ids:
            tasks.append(record_player_result(uid, "draw"))
    if tasks:
        await asyncio.gather(*tasks)


async def get_leaders(limit: int = 20) -> List[Dict[str, Any]]:
    pool = await get_pool()
    if not pool:
        return []
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, username, avatar_url, games_played, wins, losses, draws,
                   CASE WHEN games_played > 0 THEN ROUND((wins::decimal / games_played) * 100) ELSE 0 END AS win_rate
            FROM users
            ORDER BY wins DESC, updated_at DESC
            LIMIT $1;
            """,
            limit,
        )
    return [dict(row) for row in rows]


async def get_user_profile(user_id: str | int) -> Optional[Dict[str, Any]]:
    if not is_numeric_id(user_id):
        return None

    pool = await get_pool()
    if not pool:
        return None

    numeric_id = int(user_id)
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT id, username, avatar_url, games_played, wins, losses, draws, created_at, updated_at,
                   CASE WHEN games_played > 0 THEN ROUND((wins::decimal / games_played) * 100) ELSE 0 END AS win_rate
            FROM users
            WHERE id = $1;
            """,
            numeric_id,
        )

    if not row:
        return None

    profile = dict(row)
    try:
        await refresh_user_achievements(numeric_id)
        achievements = await get_user_achievements(numeric_id)
        profile["achievements"] = achievements
        profile["achievements_summary"] = {
            "total": len(achievements),
            "unlocked": len([a for a in achievements if a.get("unlocked")]),
        }
    except Exception as exc:  # noqa: BLE001
        print("get_user_profile achievements error:", exc)

    return profile


async def refresh_user_achievements(user_id: str | int) -> None:
    if not is_numeric_id(user_id):
        return
    pool = await get_pool()
    if not pool:
        return

    numeric_id = int(user_id)
    async with pool.acquire() as conn:
        stats = await conn.fetchrow(
            """
            SELECT id, games_played, wins, losses, draws,
                   CASE WHEN games_played > 0 THEN ROUND((wins::decimal / games_played) * 100) ELSE 0 END AS win_rate
            FROM users
            WHERE id = $1;
            """,
            numeric_id,
        )
        if not stats:
            return

        for definition in ACHIEVEMENTS:
            evaluation = evaluate_achievement(definition, dict(stats))
            unlocked_expr = (
                "CASE WHEN user_achievements.unlocked THEN user_achievements.unlocked_at ELSE NOW() END"
                if evaluation["unlocked"]
                else "CASE WHEN user_achievements.unlocked THEN user_achievements.unlocked_at ELSE NULL END"
            )
            await conn.execute(
                f"""
                INSERT INTO user_achievements (user_id, achievement_id, progress_value, progress_percent, unlocked, unlocked_at, details, updated_at)
                VALUES ($1, $2, $3, $4, $5, CASE WHEN $5 THEN NOW() ELSE NULL END, $6::jsonb, NOW())
                ON CONFLICT (user_id, achievement_id) DO UPDATE SET
                  progress_value = EXCLUDED.progress_value,
                  progress_percent = EXCLUDED.progress_percent,
                  unlocked = EXCLUDED.unlocked,
                  unlocked_at = {unlocked_expr},
                  details = EXCLUDED.details,
                  updated_at = NOW();
                """,
                numeric_id,
                definition.id,
                evaluation["progressValue"],
                evaluation["progressPercent"],
                evaluation["unlocked"],
                json.dumps({**(definition.extra or {}), **(evaluation["details"] or {})}),
            )


async def get_user_achievements(user_id: str | int) -> List[Dict[str, Any]]:
    if not is_numeric_id(user_id):
        return []
    pool = await get_pool()
    if not pool:
        return []

    numeric_id = int(user_id)
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT
              a.id,
              a.name,
              a.description,
              a.metric,
              a.target,
              a.icon,
              a.order_index,
              a.extra,
              COALESCE(ua.progress_value, 0)   AS progress_value,
              COALESCE(ua.progress_percent, 0) AS progress_percent,
              COALESCE(ua.unlocked, false)     AS unlocked,
              ua.unlocked_at,
              COALESCE(ua.details, '{}'::jsonb) AS details
            FROM achievements a
            LEFT JOIN user_achievements ua ON ua.achievement_id = a.id AND ua.user_id = $1
            ORDER BY a.order_index ASC, a.id ASC;
            """,
            numeric_id,
        )

    formatted: List[Dict[str, Any]] = []
    for row in rows:
        formatted.append(
            {
                "id": row["id"],
                "name": row["name"],
                "description": row["description"],
                "metric": row["metric"],
                "target": int(row["target"]),
                "icon": row["icon"] or "",
                "order": int(row["order_index"] or 0),
                "progress_value": float(row["progress_value"] or 0),
                "progress_percent": float(row["progress_percent"] or 0),
                "unlocked": bool(row["unlocked"]),
                "unlocked_at": row["unlocked_at"],
                "extra": row["extra"] or {},
                "details": row["details"] or {},
            }
        )
    return formatted
