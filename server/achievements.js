const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));

export const ACHIEVEMENTS = [
  {
    id: "rookie_moves",
    name: "Первый шаг",
    description: "Сыграйте свою первую игру.",
    metric: "games_played",
    target: 1,
    icon: "medal",
    order: 10,
    extra: { frame: "emerald" },
  },
  {
    id: "duelist",
    name: "Охотник за опытом",
    description: "Сыграйте 10 игр.",
    metric: "games_played",
    target: 10,
    icon: "medal",
    order: 20,
    extra: { frame: "blue" },
  },
  {
    id: "veteran",
    name: "Ветеран поля",
    description: "Сыграйте 50 игр.",
    metric: "games_played",
    target: 50,
    icon: "medal",
    order: 30,
    extra: { frame: "violet" },
  },
  {
    id: "first_blood",
    name: "Первая победа",
    description: "Одержите первую победу.",
    metric: "wins",
    target: 1,
    icon: "trophy",
    order: 40,
    extra: { frame: "amber" },
  },
  {
    id: "champion",
    name: "Охотник за победами",
    description: "Одержите 25 побед.",
    metric: "wins",
    target: 25,
    icon: "trophy",
    order: 50,
    extra: { frame: "rose" },
  },
  {
    id: "peacemaker",
    name: "Миротворец",
    description: "Сыграйте 5 ничьих.",
    metric: "draws",
    target: 5,
    icon: "handshake",
    order: 60,
    extra: { frame: "sky" },
  },
  {
    id: "strategist",
    name: "Стратег",
    description: "Достигните винрейта 60% минимум в 10 играх.",
    metric: "win_rate",
    target: 60,
    icon: "medal",
    order: 70,
    extra: { frame: "indigo", min_games: 10 },
  },
  {
    id: "marathon",
    name: "Марафонец",
    description: "Сыграйте 100 игр.",
    metric: "games_played",
    target: 100,
    icon: "medal",
    order: 80,
    extra: { frame: "teal" },
  },
];

export function evaluateAchievement(definition, stats) {
  const gamesPlayed = Number(stats?.games_played ?? 0);
  const wins = Number(stats?.wins ?? 0);
  const losses = Number(stats?.losses ?? 0);
  const draws = Number(stats?.draws ?? 0);
  const winRate = Number(stats?.win_rate ?? 0);

  let progressValue = 0;
  let unlocked = false;
  let percent = 0;
  const extraDetails = {
    gamesPlayed,
    wins,
    losses,
    draws,
    winRate,
  };

  switch (definition.metric) {
    case "games_played":
      progressValue = gamesPlayed;
      unlocked = gamesPlayed >= definition.target;
      break;
    case "wins":
      progressValue = wins;
      unlocked = wins >= definition.target;
      break;
    case "draws":
      progressValue = draws;
      unlocked = draws >= definition.target;
      break;
    case "win_rate": {
      const minGames = Number(definition.extra?.min_games ?? 0);
      const hasMinGames = gamesPlayed >= minGames;
      progressValue = winRate;
      extraDetails.minGames = minGames;
      extraDetails.hasMinGames = hasMinGames;
      percent = definition.target > 0 ? clamp(Math.round((winRate / definition.target) * 100)) : 0;
      if (!hasMinGames && minGames > 0) {
        const reqPercent = clamp(Math.round((gamesPlayed / minGames) * 100));
        percent = Math.min(percent, reqPercent);
      }
      unlocked = hasMinGames && winRate >= definition.target;
      break;
    }
    default:
      progressValue = 0;
      unlocked = false;
      break;
  }

  if (definition.metric !== "win_rate") {
    percent = definition.target > 0
      ? clamp(Math.round((progressValue / definition.target) * 100))
      : 0;
  }

  return {
    progressValue,
    progressPercent: clamp(percent),
    unlocked,
    details: extraDetails,
  };
}
