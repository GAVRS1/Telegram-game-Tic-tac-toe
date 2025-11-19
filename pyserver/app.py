from __future__ import annotations

from typing import Any, Dict

from fastapi import FastAPI, HTTPException, Request, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover
    load_dotenv = None

from .bot import TelegramBot
from .db import close_pool, ensure_schema, get_leaders, get_user_profile
from .matchmaking import MatchmakingServer
from .settings import get_settings


def create_app() -> FastAPI:
    if load_dotenv:
        load_dotenv()

    settings = get_settings()
    app = FastAPI(title="Tic-Tac-Toe Telegram", version="2.0.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.public_url] if settings.public_url else ["*"] ,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    matchmaking = MatchmakingServer(settings)
    bot = TelegramBot(settings)
    app.state.settings = settings
    app.state.matchmaking = matchmaking
    app.state.bot = bot

    @app.on_event("startup")
    async def _startup() -> None:  # noqa: D401
        if settings.has_database:
            await ensure_schema()
        await bot.start()

    @app.on_event("shutdown")
    async def _shutdown() -> None:  # noqa: D401
        await bot.stop()
        await close_pool()

    @app.get("/config.json")
    async def config(request: Request) -> Dict[str, Any]:
        proto = request.headers.get("x-forwarded-proto") or request.url.scheme
        host = request.headers.get("x-forwarded-host") or request.headers.get("host") or f"localhost:{settings.port}"
        origin = f"{proto}://{host}"
        web_app_url = settings.public_url or origin.replace("http://", "https://")
        ws_url = (settings.public_url or origin).replace("http", "ws")
        return {"webAppUrl": web_app_url, "wsUrl": ws_url}

    @app.get("/leaders")
    async def leaders() -> Dict[str, Any]:
        try:
            data = await get_leaders(20)
            return {"ok": True, "leaders": data}
        except Exception:
            raise HTTPException(status_code=500, detail="leaders error")

    @app.get("/profile/{user_id}")
    async def profile(user_id: str) -> Dict[str, Any]:
        if not user_id.isdigit():
            raise HTTPException(status_code=400, detail="invalid id")
        try:
            profile_data = await get_user_profile(user_id)
            return {"ok": True, "profile": profile_data}
        except Exception:
            raise HTTPException(status_code=500, detail="profile error")

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket) -> None:
        await matchmaking.handle(websocket)

    public_dir = settings.public_dir
    if not public_dir.exists():
        raise RuntimeError(f"Public directory not found: {public_dir}")
    app.mount("/", StaticFiles(directory=str(public_dir), html=True), name="public")

    return app


app = create_app()
