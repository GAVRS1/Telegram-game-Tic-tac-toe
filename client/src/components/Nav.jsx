import React from "react";

export function Nav({ onRating, onProfile, onAchievements, onlineStats }) {
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
      <button className="navbtn" id="tabAchievements" aria-label="Достижения" title="Достижения" onClick={onAchievements}>
        <div className="sym" aria-hidden="true" style={{ fontSize: "28px" }}>
          🏆
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
