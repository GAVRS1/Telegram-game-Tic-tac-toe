from __future__ import annotations

import asyncio
import json
import secrets
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from fastapi import WebSocket
from starlette.websockets import WebSocketDisconnect, WebSocketState

from .db import get_user_profile, record_match_outcome, upsert_user
from .settings import Settings
from .telegram_utils import extract_user_data, validate_telegram_webapp_data
from .utils import is_numeric_id, sanitize_string, sanitize_username

LINES = [
    (0, 1, 2),
    (3, 4, 5),
    (6, 7, 8),
    (0, 3, 6),
    (1, 4, 7),
    (2, 5, 8),
    (0, 4, 8),
    (2, 4, 6),
]


@dataclass
class Session:
    id: str
    name: str
    username: str
    avatar: str
    last_opponent: Optional[str] = None
    is_verified: bool = False


@dataclass
class GameState:
    id: str
    x: str
    o: str
    board: List[Optional[str]]
    turn: str


class MatchmakingServer:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.ws_by_uid: Dict[str, WebSocket] = {}
        self.user_by_ws: Dict[WebSocket, Session] = {}
        self.games: Dict[str, GameState] = {}
        self.queue: List[WebSocket] = []
        self._lock = asyncio.Lock()
        self._rate_limit: Dict[WebSocket, Dict[str, float]] = {}

    async def handle(self, websocket: WebSocket) -> None:
        await websocket.accept()
        try:
            while True:
                try:
                    payload = await asyncio.wait_for(
                        websocket.receive_json(), timeout=self.settings.heartbeat_interval
                    )
                except asyncio.TimeoutError:
                    if not await self._send(websocket, {"t": "heartbeat"}):
                        break
                    try:
                        payload = await asyncio.wait_for(
                            websocket.receive_json(), timeout=self.settings.heartbeat_timeout
                        )
                    except asyncio.TimeoutError:
                        break
                    if isinstance(payload, dict) and payload.get("t") == "heartbeat.ack":
                        continue
                except WebSocketDisconnect:
                    break
                except Exception:
                    continue

                if not isinstance(payload, dict):
                    continue

                if not self._check_rate_limit(websocket):
                    await websocket.close(code=1011, reason="rate limit")
                    break

                message_type = str(payload.get("t", "")).replace(".", "_")
                handler = getattr(self, f"handle_{message_type}", None)
                if handler:
                    try:
                        await handler(websocket, payload)
                    except Exception as exc:  # noqa: BLE001
                        print("WS handler error:", exc)
        finally:
            await self._cleanup(websocket)

    def _check_rate_limit(self, websocket: WebSocket) -> bool:
        now = time.monotonic()
        info = self._rate_limit.setdefault(websocket, {"ts": now, "count": 0})
        if now - info["ts"] > 1:
            info["ts"] = now
            info["count"] = 0
        info["count"] += 1
        return info["count"] <= 30

    async def handle_heartbeat_ack(self, websocket: WebSocket, _msg: Dict[str, Any]) -> None:  # noqa: D401
        return

    async def handle_hello(self, websocket: WebSocket, message: Dict[str, Any]) -> None:
        if not self._validate_hello_message(message):
            return

        uid = str(message["uid"])
        name = sanitize_string(message.get("name") or "Player") or "Player"
        avatar = (message.get("avatar") or "")[:500]
        username_hint = sanitize_username(message.get("username"))
        init_data = message.get("initData") or ""

        profile = Session(
            id=uid,
            name=name,
            username=username_hint,
            avatar=avatar,
            is_verified=False,
        )

        if init_data and isinstance(init_data, str) and validate_telegram_webapp_data(init_data):
            user_data = extract_user_data(init_data)
            if user_data and str(user_data.get("id")) == uid:
                profile = Session(
                    id=uid,
                    name=self._build_telegram_name(user_data),
                    username=sanitize_username(user_data.get("username")),
                    avatar=(user_data.get("photo_url") or "").strip(),
                    is_verified=True,
                )

        previous = self.ws_by_uid.get(uid)
        if previous and previous is not websocket:
            try:
                asyncio.create_task(previous.close())
            except RuntimeError:
                pass

        self.ws_by_uid[uid] = websocket
        self.user_by_ws[websocket] = profile
        print(f"[HELLO] uid={uid} name={profile.name} verified={profile.is_verified}")

        if is_numeric_id(uid):
            try:
                username_for_db = profile.username or profile.name
                await upsert_user(id=uid, username=username_for_db, avatar_url=profile.avatar)
            except Exception as exc:  # noqa: BLE001
                print("upsert_user error:", exc)

    async def handle_queue_join(self, websocket: WebSocket, _msg: Dict[str, Any]) -> None:
        async with self._lock:
            if websocket not in self.queue:
                self.queue.append(websocket)
            pair: Optional[List[str]] = None
            while len(self.queue) >= 2:
                first = self.queue.pop(0)
                first_session = self.user_by_ws.get(first)
                if not first_session:
                    continue
                second_index = next(
                    (idx for idx, ws in enumerate(self.queue) if self._valid_pair(first_session, ws)),
                    -1,
                )
                if second_index == -1:
                    self.queue.insert(0, first)
                    break
                second = self.queue.pop(second_index)
                second_session = self.user_by_ws.get(second)
                if not second_session or second_session.id == first_session.id:
                    self.queue.insert(0, first)
                    if second:
                        self.queue.append(second)
                    continue
                pair = [first_session.id, second_session.id]
                break
        if pair:
            await self._start_game(pair[0], pair[1])

    async def handle_queue_leave(self, websocket: WebSocket, _msg: Dict[str, Any]) -> None:
        async with self._lock:
            if websocket in self.queue:
                self.queue.remove(websocket)

    async def handle_game_move(self, websocket: WebSocket, message: Dict[str, Any]) -> None:
        if not self._validate_game_move(message):
            return
        game_id = message["gameId"]
        index = int(message["i"])
        game = self.games.get(game_id)
        if not game:
            return
        session = self.user_by_ws.get(websocket)
        if not session:
            return
        my_symbol = "X" if session.id == game.x else "O" if session.id == game.o else None
        if my_symbol is None or game.turn != my_symbol:
            return
        if game.board[index]:
            return
        game.board[index] = my_symbol
        game.turn = "O" if my_symbol == "X" else "X"
        result = self._check_win(game.board)
        await self._broadcast_state(game.id)
        if result is not None:
            reason = "draw" if result["by"] is None else "win"
            await self._end_game(game.id, reason=reason, win_by=result["by"])

    async def handle_game_resign(self, websocket: WebSocket, message: Dict[str, Any]) -> None:
        game_id = message.get("gameId")
        game = self.games.get(game_id)
        if not game:
            return
        session = self.user_by_ws.get(websocket)
        if not session:
            return
        winner = None
        if session.id == game.x:
            winner = "O"
        elif session.id == game.o:
            winner = "X"
        await self._end_game(game.id, reason="resign", win_by=winner)

    async def handle_rematch_offer(self, websocket: WebSocket, _msg: Dict[str, Any]) -> None:
        me = self.user_by_ws.get(websocket)
        if not me or not me.last_opponent:
            return
        opponent_ws = self.ws_by_uid.get(me.last_opponent)
        if opponent_ws:
            payload = {"t": "rematch.offer", "from": {
                "id": me.id,
                "name": me.name,
                "username": me.username,
                "avatar": me.avatar,
            }}
            await self._send(opponent_ws, payload)

    async def handle_rematch_accept(self, websocket: WebSocket, _msg: Dict[str, Any]) -> None:
        me = self.user_by_ws.get(websocket)
        if not me or not me.last_opponent or me.id == me.last_opponent:
            return
        await self._start_game(me.id, me.last_opponent)

    async def handle_rematch_decline(self, websocket: WebSocket, _msg: Dict[str, Any]) -> None:
        me = self.user_by_ws.get(websocket)
        if not me or not me.last_opponent:
            return
        opponent_ws = self.ws_by_uid.get(me.last_opponent)
        payload = {"t": "rematch.declined", "by": me.id}
        if opponent_ws:
            await self._send(opponent_ws, payload)
        await self._send(websocket, payload)

    async def handle_queue_reset(self, websocket: WebSocket, _msg: Dict[str, Any]) -> None:
        await self.handle_queue_leave(websocket, _msg)

    async def handle_heartbeat(self, websocket: WebSocket, _msg: Dict[str, Any]) -> None:
        await self._send(websocket, {"t": "heartbeat.ack"})

    def _valid_pair(self, session: Session, candidate_ws: WebSocket) -> bool:
        other = self.user_by_ws.get(candidate_ws)
        return bool(other and other.id and other.id != session.id)

    async def _start_game(self, uid_a: str, uid_b: str) -> None:
        if not uid_a or not uid_b or uid_a == uid_b:
            return
        game_id = f"g_{int(time.time() * 1000)}_{secrets.token_hex(4)}"
        first_is_x = secrets.randbelow(2) == 0
        x_id = uid_a if first_is_x else uid_b
        o_id = uid_b if first_is_x else uid_a
        game = GameState(id=game_id, x=x_id, o=o_id, board=[None] * 9, turn="X")
        self.games[game_id] = game

        for uid, opponent in [(x_id, o_id), (o_id, x_id)]:
            session_ws = self.ws_by_uid.get(uid)
            session = self.user_by_ws.get(session_ws) if session_ws else None
            if session:
                session.last_opponent = opponent

        opponent_payloads = await asyncio.gather(
            self._build_opponent_payload(o_id),
            self._build_opponent_payload(x_id),
        )
        await self._send(self.ws_by_uid.get(x_id), {
            "t": "game.start",
            "gameId": game_id,
            "you": "X",
            "turn": game.turn,
            "opp": opponent_payloads[0],
        })
        await self._send(self.ws_by_uid.get(o_id), {
            "t": "game.start",
            "gameId": game_id,
            "you": "O",
            "turn": game.turn,
            "opp": opponent_payloads[1],
        })
        print(f"[GAME] {game_id}: {x_id} vs {o_id}")

    async def _end_game(self, game_id: str, *, reason: str, win_by: Optional[str]) -> None:
        game = self.games.pop(game_id, None)
        if not game:
            return

        payload = {"t": "game.end", "reason": reason, "by": win_by}
        await self._send(self.ws_by_uid.get(game.x), payload)
        await self._send(self.ws_by_uid.get(game.o), payload)

        try:
            if win_by in {"X", "O"}:
                winner_id = game.x if win_by == "X" else game.o
                loser_id = game.o if win_by == "X" else game.x
                await record_match_outcome(winner_id=winner_id, loser_id=loser_id)
            elif reason == "draw":
                await record_match_outcome(draw_ids=[game.x, game.o])
        except Exception as exc:  # noqa: BLE001
            print("record_match_outcome error:", exc)

    async def _broadcast_state(self, game_id: str) -> None:
        game = self.games.get(game_id)
        if not game:
            return
        payload = {"t": "game.state", "board": game.board, "turn": game.turn, "win": self._check_win(game.board)}
        await self._send(self.ws_by_uid.get(game.x), payload)
        await self._send(self.ws_by_uid.get(game.o), payload)

    async def _build_opponent_payload(self, uid: Optional[str]) -> Optional[Dict[str, Any]]:
        if not uid:
            return None
        uid_str = str(uid)
        ws = self.ws_by_uid.get(uid_str)
        local = self.user_by_ws.get(ws) if ws else None
        name = sanitize_string(local.name if local else "")
        username = sanitize_username(local.username if local else "")
        avatar = (local.avatar if local else "") if local else ""

        if (not avatar or not username or not name) and is_numeric_id(uid_str):
            try:
                profile = await get_user_profile(uid_str)
                if profile:
                    avatar = avatar or (profile.get("avatar_url") or "")
                    username = username or sanitize_username(profile.get("username"))
                    name = name or sanitize_string(profile.get("username") or "")
            except Exception as exc:  # noqa: BLE001
                print("build_opponent_payload error:", exc)

        final_name = sanitize_string(name or (f"@{username}" if username else "Игрок")) or "Игрок"
        if local:
            local.name = final_name
            local.username = username
            if avatar:
                local.avatar = avatar

        return {"id": uid_str, "name": final_name, "username": username, "avatar": avatar}

    async def _send(self, websocket: Optional[WebSocket], payload: Dict[str, Any]) -> bool:
        if not websocket or websocket.client_state != WebSocketState.CONNECTED:
            return False
        try:
            await websocket.send_text(json.dumps(payload, ensure_ascii=False))
            return True
        except RuntimeError:
            return False

    async def _cleanup(self, websocket: WebSocket) -> None:
        async with self._lock:
            if websocket in self.queue:
                self.queue.remove(websocket)
        session = self.user_by_ws.pop(websocket, None)
        if session:
            mapped = self.ws_by_uid.get(session.id)
            if mapped is websocket:
                self.ws_by_uid.pop(session.id, None)
        self._rate_limit.pop(websocket, None)

        if session:
            affected_games = [gid for gid, g in self.games.items() if g.x == session.id or g.o == session.id]
            for gid in affected_games:
                game = self.games.get(gid)
                if not game:
                    continue
                winner = None
                if game.x == session.id and game.o:
                    winner = "O"
                elif game.o == session.id and game.x:
                    winner = "X"
                await self._end_game(gid, reason="disconnect", win_by=winner)

    def _validate_game_move(self, message: Dict[str, Any]) -> bool:
        if "gameId" not in message or not isinstance(message["gameId"], str):
            return False
        index = message.get("i")
        return isinstance(index, int) and 0 <= index <= 8

    def _validate_hello_message(self, message: Dict[str, Any]) -> bool:
        if not isinstance(message, dict):
            return False
        uid = message.get("uid")
        if not isinstance(uid, str):
            return False
        if "name" in message and not isinstance(message.get("name"), str):
            return False
        if "avatar" in message and not isinstance(message.get("avatar"), str):
            return False
        if "username" in message and not isinstance(message.get("username"), str):
            return False
        return True

    def _check_win(self, board: List[Optional[str]]) -> Optional[Dict[str, Any]]:
        for a, b, c in LINES:
            if board[a] and board[a] == board[b] == board[c]:
                return {"by": board[a], "line": [a, b, c]}
        if all(cell for cell in board):
            return {"by": None, "line": None}
        return None

    def _build_telegram_name(self, user: Dict[str, Any]) -> str:
        first = sanitize_string(user.get("first_name"))
        last = sanitize_string(user.get("last_name"))
        username = sanitize_string(user.get("username"))
        combined = f"{first} {last}".strip()
        return sanitize_string(combined or username or "Player") or "Player"
