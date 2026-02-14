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

export function Nav({ mode, onAction, onRating, onProfile, onInvite, onlineStats }) {
  const label = LABELS[mode] || "Действие";
  const canInvite = mode === "find" || mode === "waiting";
  const total = Number(onlineStats?.total ?? 0);
  const verified = Number(onlineStats?.verified ?? 0);
  const guest = Number(onlineStats?.guest ?? 0);
  const statsText = `Онлайн: ${total} · Вериф.: ${verified} · Гости: ${guest}`;

  return (
    <div className="navbar navbar--lg" id="navbar">
      <div className="online-stats" aria-live="polite">
        {statsText}
      </div>
      <button className="navbtn" id="tabRating" aria-label="Рейтинг" title="Рейтинг" onClick={onRating}>
        <div className="sym">
          <img src="/img/leaderboard.svg" alt="Рейтинг" className="icon" />
        </div>
      </button>
      {canInvite ? (
        <button className="navbtn" id="tabInvite" aria-label="Пригласить" title="Пригласить" onClick={onInvite}>
          <div className="sym" aria-hidden="true" style={{ fontSize: "28px" }}>🔗</div>
        </button>
      ) : null}
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
