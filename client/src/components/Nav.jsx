import React from "react";

const ICONS = {
  find: "/img/search.svg",
  waiting: "/img/waiting.svg",
  resign: "/img/surrender.svg",
  rematch: "/img/search.svg",
};

const LABELS = {
  find: "Найти",
  waiting: "Поиск",
  resign: "Сдаться",
  rematch: "Реванш",
};

export function Nav({ mode, onAction, onRating, onProfile, onlineStats }) {
  const label = LABELS[mode] || "Действие";
  const total = Number.isFinite(onlineStats?.total) ? onlineStats.total : 0;
  const verified = Number.isFinite(onlineStats?.verified) ? onlineStats.verified : 0;
  const guest = Number.isFinite(onlineStats?.guest) ? onlineStats.guest : 0;

  return (
    <div className="navbar navbar--lg" id="navbar">
      <div className="online-stats" aria-live="polite">
        <span className="online-stats__label">Онлайн</span>
        <span className="online-stats__value">{total}</span>
        <span className="online-stats__breakdown">V {verified} · G {guest}</span>
      </div>
      <button className="navbtn" id="tabRating" aria-label="Рейтинг" title="Рейтинг" onClick={onRating}>
        <div className="sym">
          <img src="/img/leaderboard.svg" alt="Рейтинг" className="icon" />
        </div>
      </button>
      <button
        className={`navbtn centerAction ${mode === "waiting" ? "is-waiting" : ""} ${
          mode === "resign" || mode === "rematch" ? "active" : ""
        }`}
        id="tabGame"
        aria-label={label}
        title={label}
        onClick={() => onAction(mode)}
      >
        <div className="sym" id="centerSym">
          <img src={ICONS[mode] || ICONS.find} alt="Действие" className="icon-lg" />
        </div>
      </button>
      <button className="navbtn" id="tabProfile" aria-label="Профиль" title="Профиль" onClick={onProfile}>
        <div className="sym">
          <img src="/img/profile-info.svg" alt="Профиль" className="icon" />
        </div>
      </button>
    </div>
  );
}
