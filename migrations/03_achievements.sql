-- migrations/003_achievements.sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS current_win_streak INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS best_win_streak INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS achievements (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  icon TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  metric TEXT NOT NULL,
  target INTEGER NOT NULL,
  requires_games INTEGER NOT NULL DEFAULT 0,
  points INTEGER NOT NULL DEFAULT 0,
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_achievements (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
  progress INTEGER NOT NULL DEFAULT 0,
  percent INTEGER NOT NULL DEFAULT 0,
  unlocked_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, achievement_id)
);

INSERT INTO achievements (id, name, description, icon, difficulty, metric, target, requires_games, points, order_index)
VALUES
  ('rookie_steps', 'Первые шаги', 'Сыграйте 5 игр', '🥾', 'bronze', 'games_played', 5, 0, 10, 1),
  ('veteran_player', 'Ветеран', 'Сыграйте 25 игр', '🛡️', 'silver', 'games_played', 25, 0, 25, 2),
  ('first_victory', 'Первая победа', 'Выиграйте свою первую игру', '🏆', 'bronze', 'wins', 1, 0, 10, 3),
  ('ten_wins', 'Охотник за победами', 'Наберите 10 побед', '⚔️', 'silver', 'wins', 10, 0, 30, 4),
  ('streak_master', 'Мастер серии', 'Достигните серии из 3 побед', '🔥', 'gold', 'best_win_streak', 3, 0, 40, 5),
  ('streak_legend', 'Легенда серии', 'Достигните серии из 7 побед', '🌟', 'platinum', 'best_win_streak', 7, 0, 80, 6),
  ('strategist', 'Стратег', 'Сыграйте 5 ничьих', '♟️', 'silver', 'draws', 5, 0, 20, 7),
  ('win_rate_elite', 'Элита', 'Поддерживайте винрейт 60% после 20 игр', '🧠', 'gold', 'win_rate', 60, 20, 60, 8)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  difficulty = EXCLUDED.difficulty,
  metric = EXCLUDED.metric,
  target = EXCLUDED.target,
  requires_games = EXCLUDED.requires_games,
  points = EXCLUDED.points,
  order_index = EXCLUDED.order_index,
  updated_at = NOW();
