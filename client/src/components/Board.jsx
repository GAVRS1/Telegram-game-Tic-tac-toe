import React from "react";

function buildGuestUsername(id, fallback = "guest") {
  const safeId = String(id ?? "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(-8);
  return `@${safeId ? `guest_${safeId}` : fallback}`;
}

function buildUserView(user, fallbackName, fallbackAvatar = "/img/logo.svg") {
  const cleanName = user?.name?.trim();
  const cleanUsername = user?.username?.trim().replace(/^@/, "");
  const username = cleanUsername ? `@${cleanUsername}` : buildGuestUsername(user?.id);
  const name = cleanName || fallbackName;
  const avatar = user?.avatar || fallbackAvatar;

  return { name, username, avatar };
}

export function Board({
  me,
  game,
  onlineStats,
  coinBalance = 0,
  statusText,
  winLine,
  onCellClick,
  onAuthorClick,
  boardContent = null,
  modesLayout = false,
  viewTransitionClass = "",
  lobbyInviteCode = "",
  onInviteCodeClick,
}) {
  const myView = buildUserView(me, "Вы");

  const hasOpp = game?.opp && String(game?.opp?.id) !== String(me?.id);
  const oppView = hasOpp
    ? buildUserView(game.opp, "Соперник")
    : { name: "Соперник", username: "@guest", avatar: "/img/logo.svg" };

  const youMark = game?.you || "—";
  const oppMark = game?.you ? (game.you === "X" ? "O" : "X") : "—";
  const totalOnline = Number(onlineStats?.total ?? 0);
  const safeCoinBalance = Number(coinBalance ?? 0);
  const roundWinsX = Number(game?.roundWinsX ?? 0);
  const roundWinsO = Number(game?.roundWinsO ?? 0);
  const targetWins = Number(game?.matchTargetWins ?? 3);
  const roundNumber = Number(game?.roundNumber ?? 1);
  const mySeriesWins = game?.you === "X" ? roundWinsX : roundWinsO;
  const oppSeriesWins = game?.you === "X" ? roundWinsO : roundWinsX;
  const myTurn = Boolean(game?.turn && game?.turn === youMark);
  const oppTurn = Boolean(game?.turn && game?.turn === oppMark);

  const renderRoundSquares = (wins, mark) => {
    const safeWins = Math.max(0, Number(wins ?? 0));
    const squaresCount = Math.max(1, Number(targetWins ?? 3));
    return (
      <div className="round-track" aria-label={`Победы раундов: ${safeWins} из ${squaresCount}`}>
        {Array.from({ length: squaresCount }, (_, index) => {
          const isFilled = index < safeWins;
          return (
            <span
              key={`${mark}-${index}`}
              className={`round-square ${isFilled ? `filled ${mark?.toLowerCase?.()}` : ""}`.trim()}
            />
          );
        })}
      </div>
    );
  };

  return (
    <div
      className={`wrap ${modesLayout ? "wrap--modes" : "wrap--game"} ${viewTransitionClass}`.trim()}
    >
      <div className="top-meta">
        <button className="author-badge" type="button" title="Автор 0xGavrs" onClick={onAuthorClick}>
          <img src="https://t.me/i/userpic/320/rsgavrs.jpg" alt="0xGavrs" loading="lazy" />
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", lineHeight: 1.2 }}>
            <span>0xGavrs</span>
            <small>Автор игры</small>
          </div>
        </button>
        {lobbyInviteCode ? (
          <button className="lobby-code" type="button" onClick={onInviteCodeClick} title="Нажмите, чтобы скопировать код">
            <small>Инвайт-код</small>
            <span>{lobbyInviteCode}</span>
          </button>
        ) : null}
        <div className="top-meta__stats">
          <div className="coin-balance" aria-live="polite">
            <img className="coin-icon" src="/img/coin.svg" alt="" aria-hidden="true" />
            <span>{safeCoinBalance}</span>
          </div>
          <div className="online-stats online-stats--top" aria-live="polite">
            Онлайн: {totalOnline}
          </div>
        </div>
      </div>

      <div className={`card ${modesLayout ? "card--modes" : "card--game"}`}>
        {!modesLayout ? (
          <>
            <section className="match-panel" aria-label="Информация о матче">
              <article className={`badge ${myTurn ? "badge--active" : ""}`.trim()} id="youBadge">
                <div className="info">
                  <img className="ava" id="youAva" src={myView.avatar} alt={myView.name} />
                  <div className="text">
                    <span className="name" id="youName" title={myView.name}>
                      {myView.name}
                    </span>
                    <span className="username" id="youUsername">
                      {myView.username}
                    </span>
                  </div>
                </div>
                <div className="badge-meta">
                  <span className={`mark ${String(youMark).toLowerCase()}`}>{youMark}</span>
                </div>
              </article>

              <article className="match-status-panel">
                <div className={`status-line match-status ${statusText?.blink ? "blink" : ""}`} id="status">
                  {statusText?.text || "Готово"}
                </div>
                <div className="status-line match-round-track" id="seriesScore">
                  {renderRoundSquares(mySeriesWins, youMark)}
                  <span className="match-round">Раунд {roundNumber}</span>
                  {renderRoundSquares(oppSeriesWins, oppMark)}
                </div>
                <div className="match-score" aria-label="Счет по раундам">
                  <span>{mySeriesWins}</span>
                  <span className="match-score__divider">:</span>
                  <span>{oppSeriesWins}</span>
                </div>
              </article>

              <article
                className={`badge badge--opponent ${oppTurn ? "badge--active" : ""}`.trim()}
                id="oppBadge"
              >
                <div className="info">
                  <img className="ava" id="oppAva" src={oppView.avatar} alt={oppView.name} />
                  <div className="text">
                    <span className="name" id="oppName" title={oppView.name}>
                      {oppView.name}
                    </span>
                    <span className="username" id="oppUsername">
                      {oppView.username}
                    </span>
                  </div>
                </div>
                <div className="badge-meta">
                  <span className={`mark ${String(oppMark).toLowerCase()}`}>{oppMark}</span>
                </div>
              </article>
            </section>

            <section className="game-main" aria-label="Игровое поле">
              {boardContent ? (
                <div className="board-slot">{boardContent}</div>
              ) : (
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
              )}
            </section>
          </>
        ) : (
          <div className="board-slot board-slot--modes">{boardContent}</div>
        )}
      </div>
    </div>
  );
}
