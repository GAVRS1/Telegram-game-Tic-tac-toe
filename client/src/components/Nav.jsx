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

export function Nav({ mode, onAction, onRating, onProfile }) {
  const label = LABELS[mode] || "Действие";

  return (
    <div className="navbar navbar--lg" id="navbar">
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
