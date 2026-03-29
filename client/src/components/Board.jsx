import React from "react";

function buildUserLabel(user) {
  const name = user?.name?.trim();
  const username = user?.username?.trim();
  if (name) return name;
  if (username) return `@${username.replace(/^@/, "")}`;
  return "Player";
}

export function Board({ me, game, statusText, winLine, onCellClick, onAuthorClick }) {
  const myName = me?.name?.trim() ? me.name : "Вы";
  const myUsername = me?.username?.trim() ? `@${me.username.replace(/^@/, "")}` : "";
  const myAvatar = me?.avatar || "/img/logo.svg";

  const hasOpp = game?.opp && String(game?.opp?.id) !== String(me?.id);
  const oppNameRaw = hasOpp ? game.opp.name : null;
  const oppUsernameRaw = hasOpp ? game.opp.username : null;
  const oppUsername = oppUsernameRaw?.trim() ? `@${oppUsernameRaw.replace(/^@/, "")}` : "";
  const oppLabel = oppNameRaw?.trim() || oppUsername || "Оппонент";
  const oppAvatar = hasOpp ? game.opp.avatar || "/img/logo.svg" : "/img/logo.svg";

  const youMark = game?.you || "—";
  const oppMark = game?.you ? (game.you === "X" ? "O" : "X") : "—";

  return (
    <div className="wrap">
      <button className="author-badge" type="button" title="Автор 0xGavrs" onClick={onAuthorClick}>
        <img src="https://t.me/i/userpic/320/rsgavrs.jpg" alt="0xGavrs" loading="lazy" />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", lineHeight: 1.2 }}>
          <span>0xGavrs</span>
          <small>Автор игры</small>
        </div>
      </button>

      <div className="card">
        <div className="badges">
          <div className="badge" id="youBadge">
            <div className="info">
              <img className="ava" id="youAva" src={myAvatar} alt={myName} />
              <div className="text">
                <span className="name" id="youName" title={buildUserLabel(me)}>
                  {myName}
                </span>
                <span className="username" id="youUsername" style={{ display: myUsername ? "block" : "none" }}>
                  {myUsername}
                </span>
              </div>
            </div>
            <span className={`mark ${game?.you === "X" ? "x" : "o"}`} id="youMark">
              {youMark}
            </span>
          </div>
          <div className="badge" id="oppBadge">
            <div className="info">
              <img className="ava" id="oppAva" src={oppAvatar} alt={oppLabel} />
              <div className="text">
                <span className="name" id="oppName" title={oppLabel}>
                  {oppLabel}
                </span>
                <span
                  className="username"
                  id="oppUsername"
                  style={{ display: oppUsername ? "block" : "none" }}
                >
                  {oppUsername}
                </span>
              </div>
            </div>
            <span className={`mark ${game?.you === "X" ? "o" : "x"}`} id="oppMark">
              {oppMark}
            </span>
          </div>
        </div>

        <div className={`status-line ${statusText?.blink ? "blink" : ""}`} id="status">
          {statusText?.text || "Готово"}
        </div>
        <div className="board" id="board">
          {game?.board?.map((value, index) => {
            const isWin = Array.isArray(winLine) && winLine.includes(index);
            const isDisabled = Boolean(value) || !game?.myMoveAllowed;
            return (
              <button
                key={index}
                type="button"
                className={`cell${value ? ` ${value.toLowerCase()}` : ""}${isWin ? " win" : ""}${
                  isDisabled ? " disabled" : ""
                }`}
                data-i={index}
                onClick={() => onCellClick(index)}
              >
                {value || ""}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
