import React, { useCallback, useRef, useState } from "react";

const SWIPE_THRESHOLD = 45;

function FriendsCardActions({ onCreate, onJoin }) {
  const [joinMode, setJoinMode] = useState(false);
  const [inviteCode, setInviteCode] = useState("");

  return (
    <div className="friends-card__actions" onClick={(event) => event.stopPropagation()}>
      <button type="button" className="friends-card__btn" onClick={onCreate}>
        Создать лобби
      </button>

      {!joinMode ? (
        <button type="button" className="friends-card__btn friends-card__btn--ghost" onClick={() => setJoinMode(true)}>
          Присоединиться
        </button>
      ) : (
        <div className="friends-card__join-row">
          <input
            className="friends-card__input"
            value={inviteCode}
            onChange={(event) => setInviteCode(event.target.value)}
            placeholder="Введите инвайт-код"
          />
          <button
            type="button"
            className="friends-card__btn"
            onClick={() => {
              const code = inviteCode.trim();
              if (!code) return;
              onJoin(code);
            }}
          >
            Войти
          </button>
        </div>
      )}
    </div>
  );
}

export function GameModesCarousel({ items, activeIndex, onChange, friendsActions }) {
  const pointerStateRef = useRef({ id: null, startX: 0, moved: false });

  const move = useCallback(
    (delta) => {
      const count = Array.isArray(items) ? items.length : 0;
      if (!count) return;
      onChange((activeIndex + delta + count) % count);
    },
    [activeIndex, items, onChange]
  );

  const onPointerDown = useCallback((event) => {
    pointerStateRef.current = { id: event.pointerId, startX: event.clientX, moved: false };
  }, []);

  const onPointerMove = useCallback(
    (event) => {
      const state = pointerStateRef.current;
      if (state.id !== event.pointerId) return;

      const deltaX = event.clientX - state.startX;
      if (Math.abs(deltaX) < SWIPE_THRESHOLD) return;

      pointerStateRef.current = { id: null, startX: 0, moved: true };
      move(deltaX > 0 ? -1 : 1);
    },
    [move]
  );

  const onPointerUp = useCallback((event) => {
    const state = pointerStateRef.current;
    if (state.id !== event.pointerId) return;
    pointerStateRef.current = { id: null, startX: 0, moved: false };
  }, []);

  const onWheel = useCallback(
    (event) => {
      event.preventDefault();
      move(event.deltaY > 0 ? 1 : -1);
    },
    [move]
  );

  return (
    <section className="modes-carousel-wrap">
      <div
        className="modes-carousel"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      >
        <div className="modes-carousel__track" style={{ transform: `translateX(-${activeIndex * 100}%)` }}>
          {items.map((item, index) => (
            <article
              key={item.id}
              className={`mode-card mode-card--vertical ${index === activeIndex ? "mode-card--active" : ""}`}
              onClick={() => {
                onChange(index);
                if (index === activeIndex && typeof item.onCardClick === "function") item.onCardClick();
              }}
            >
              <div className="mode-card__emoji" aria-hidden="true">{item.emoji}</div>
              <div className="mode-card__title">{item.title}</div>
              <div className="mode-card__description">{item.description}</div>
              {item.renderBody === "friends" ? (
                <FriendsCardActions onCreate={friendsActions?.onCreate} onJoin={friendsActions?.onJoin} />
              ) : null}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
