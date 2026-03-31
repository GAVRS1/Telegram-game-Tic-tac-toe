import React from "react";

const ICONS = {
  find: "/img/search.svg",
  waiting: "/img/waiting.svg",
  resign: "/img/surrender.svg",
};

const LABELS = {
  find: "Найти",
  waiting: "Поиск",
  resign: "Сдаться",
};

export function Nav({
  mode,
  onAction,
  onRating,
  onProfile,
  isGameScreen = false,
}) {
  const label = LABELS[mode] || "Действие";
  const showCenterAction = isGameScreen && mode === "resign";

  return (
    <div
      className={`navbar navbar--lg ${showCenterAction ? "" : "navbar--two-actions"}`.trim()}
      id="navbar"
    >
      <button
        className="navbtn"
        id="tabRating"
        aria-label="Рейтинг"
        title="Рейтинг"
        onClick={onRating}
      >
        <div className="sym">
          <img src="/img/leaderboard.svg" alt="Рейтинг" className="icon" />
        </div>
      </button>
      {showCenterAction ? (
        <button
          className="navbtn centerAction active"
          id="tabGame"
          aria-label={label}
          title={label}
          onClick={() => onAction(mode)}
        >
          <div className="sym" id="centerSym">
            <img
              src={ICONS[mode] || ICONS.find}
              alt="Действие"
              className="icon-lg"
            />
          </div>
        </button>
      ) : null}
      <button
        className="navbtn"
        id="tabProfile"
        aria-label="Профиль"
        title="Профиль"
        onClick={onProfile}
      >
        <div className="sym">
          <img src="/img/profile-info.svg" alt="Профиль" className="icon" />
        </div>
      </button>
    </div>
  );
}
