import React from "react";

function buildUserLabel(user) {
  const name = user?.name?.trim();
  const username = user?.username?.trim();
  if (name) return name;
  if (username) return `@${username.replace(/^@/, "")}`;
  return "Player";
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
  const turnAccentClass = game?.turn ? `turn-accent-${String(game.turn).toLowerCase()}` : "";

  const renderRoundSquares = (wins, mark, compact = false) => {
    const safeWins = Math.max(0, Number(wins ?? 0));
    const squaresCount = Math.max(1, Number(targetWins ?? 3));
    return (
      <div
        className={`round-track ${compact ? "round-track--compact" : ""}`.trim()}
        aria-label={`Победы раундов: ${safeWins} из ${squaresCount}`}
      >
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
              <div className="match-panel__players">
                <article
                  className={`badge ${myTurn ? `badge--active badge--active-${String(youMark).toLowerCase()}` : ""}`.trim()}
                  id="youBadge"
                >
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
                  <div className="badge-meta">
                    <span className={`mark ${String(youMark).toLowerCase()}`}>{youMark}</span>
                  </div>
                </article>

                <article
                  className={`badge ${oppTurn ? `badge--active badge--active-${String(oppMark).toLowerCase()}` : ""}`.trim()}
                  id="oppBadge"
                >
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
                  <div className="badge-meta">
                    <span className={`mark ${String(oppMark).toLowerCase()}`}>{oppMark}</span>
                  </div>
                </article>
              </div>

              <article className={`match-status-panel ${turnAccentClass}`.trim()}>
                <div className={`status-line match-status ${statusText?.blink ? "blink" : ""}`} id="status">
                  {statusText?.text || "Готово"}
                </div>
              </article>

              <article className={`match-series-panel ${turnAccentClass}`.trim()}>
                <div className="status-line match-round" id="seriesScore">
                  Раунд {roundNumber}
                </div>
                <div className="match-series-track" aria-label="Счет по раундам">
                  <span className={`mark mark--mini ${String(youMark).toLowerCase()}`}>{youMark}</span>
                  {renderRoundSquares(mySeriesWins, youMark, true)}
                </div>
                <div className="match-series-track" aria-label="Счет по раундам соперника">
                  <span className={`mark mark--mini ${String(oppMark).toLowerCase()}`}>{oppMark}</span>
                  {renderRoundSquares(oppSeriesWins, oppMark, true)}
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
