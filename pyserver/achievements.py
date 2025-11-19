from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List


@dataclass(slots=True)
class Achievement:
    id: str
    name: str
    description: str
    metric: str
    target: int
    icon: str
    order: int
    extra: Dict[str, Any]


ACHIEVEMENTS: List[Achievement] = [
    Achievement(
        id="rookie_moves",
        name="Первый шаг",
        description="Сыграйте свою первую игру.",
        metric="games_played",
        target=1,
        icon="🌱",
        order=10,
        extra={"frame": "emerald"},
    ),
    Achievement(
        id="duelist",
        name="Охотник за опытом",
        description="Сыграйте 10 игр.",
        metric="games_played",
        target=10,
        icon="🎮",
        order=20,
        extra={"frame": "blue"},
    ),
    Achievement(
        id="veteran",
        name="Ветеран поля",
        description="Сыграйте 50 игр.",
        metric="games_played",
        target=50,
        icon="🛡️",
        order=30,
        extra={"frame": "violet"},
    ),
    Achievement(
        id="first_blood",
        name="Первая победа",
        description="Одержите первую победу.",
        metric="wins",
        target=1,
        icon="🏆",
        order=40,
        extra={"frame": "amber"},
    ),
    Achievement(
        id="champion",
        name="Охотник за победами",
        description="Одержите 25 побед.",
        metric="wins",
        target=25,
        icon="🔥",
        order=50,
        extra={"frame": "rose"},
    ),
    Achievement(
        id="peacemaker",
        name="Миротворец",
        description="Сыграйте 5 ничьих.",
        metric="draws",
        target=5,
        icon="🤝",
        order=60,
        extra={"frame": "sky"},
    ),
    Achievement(
        id="strategist",
        name="Стратег",
        description="Достигните винрейта 60% минимум в 10 играх.",
        metric="win_rate",
        target=60,
        icon="🧠",
        order=70,
        extra={"frame": "indigo", "min_games": 10},
    ),
    Achievement(
        id="marathon",
        name="Марафонец",
        description="Сыграйте 100 игр.",
        metric="games_played",
        target=100,
        icon="🏅",
        order=80,
        extra={"frame": "teal"},
    ),
]


def clamp(value: float, minimum: float = 0, maximum: float = 100) -> float:
    return max(minimum, min(maximum, value))


def evaluate_achievement(definition: Achievement, stats: Dict[str, Any]) -> Dict[str, Any]:
    games_played = int(stats.get("games_played", 0) or 0)
    wins = int(stats.get("wins", 0) or 0)
    losses = int(stats.get("losses", 0) or 0)
    draws = int(stats.get("draws", 0) or 0)
    win_rate = int(stats.get("win_rate", 0) or 0)

    progress_value = 0
    unlocked = False
    percent = 0
    extra_details: Dict[str, Any] = {
        "gamesPlayed": games_played,
        "wins": wins,
        "losses": losses,
        "draws": draws,
        "winRate": win_rate,
    }

    metric = definition.metric
    if metric == "games_played":
        progress_value = games_played
        unlocked = games_played >= definition.target
    elif metric == "wins":
        progress_value = wins
        unlocked = wins >= definition.target
    elif metric == "draws":
        progress_value = draws
        unlocked = draws >= definition.target
    elif metric == "win_rate":
        min_games = int(definition.extra.get("min_games", 0) or 0)
        has_min_games = games_played >= min_games
        progress_value = win_rate
        extra_details.update({
            "minGames": min_games,
            "hasMinGames": has_min_games,
        })
        if definition.target > 0:
            percent = clamp(round((win_rate / definition.target) * 100))
        if not has_min_games and min_games > 0:
            percent = min(percent, clamp(round((games_played / min_games) * 100)))
        unlocked = has_min_games and win_rate >= definition.target
    else:
        progress_value = 0
        unlocked = False

    if metric != "win_rate":
        percent = clamp(round((progress_value / definition.target) * 100)) if definition.target > 0 else 0

    return {
        "progressValue": progress_value,
        "progressPercent": clamp(percent),
        "unlocked": unlocked,
        "details": extra_details,
    }
