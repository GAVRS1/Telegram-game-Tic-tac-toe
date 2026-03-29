import React, { useCallback, useRef, useState } from "react";

const SWIPE_THRESHOLD = 35;
const WHEEL_THRESHOLD = 45;

export function GameModesCarousel({ items, activeIndex, onChange }) {
  const pointerStateRef = useRef({ id: null, startX: 0, dragging: false });
  const wheelCarryRef = useRef(0);
  const [isDragging, setIsDragging] = useState(false);

  const itemCount = Array.isArray(items) ? items.length : 0;

  const move = useCallback(
    (delta) => {
      if (itemCount <= 0 || typeof onChange !== "function") return;
      const next = (activeIndex + delta + itemCount) % itemCount;
      onChange(next);
    },
    [activeIndex, itemCount, onChange]
  );

  const onPointerDown = useCallback((event) => {
    pointerStateRef.current = {
      id: event.pointerId,
      startX: event.clientX,
      dragging: true,
    };
    setIsDragging(true);
  }, []);

  const onPointerMove = useCallback(
    (event) => {
      const state = pointerStateRef.current;
      if (!state.dragging || state.id !== event.pointerId) return;

      const deltaX = event.clientX - state.startX;
      if (Math.abs(deltaX) < SWIPE_THRESHOLD) return;

      move(deltaX > 0 ? -1 : 1);
      pointerStateRef.current = {
        id: event.pointerId,
        startX: event.clientX,
        dragging: true,
      };
    },
    [move]
  );

  const clearPointer = useCallback((event) => {
    if (pointerStateRef.current.id !== event.pointerId) return;
    pointerStateRef.current = { id: null, startX: 0, dragging: false };
    setIsDragging(false);
  }, []);

  const onWheel = useCallback(
    (event) => {
      event.preventDefault();
      wheelCarryRef.current += event.deltaY;

      if (Math.abs(wheelCarryRef.current) < WHEEL_THRESHOLD) return;

      move(wheelCarryRef.current > 0 ? 1 : -1);
      wheelCarryRef.current = 0;
    },
    [move]
  );

  if (!itemCount) return null;

  return (
    <section className="modes-carousel-wrap">
      <div
        className={`modes-carousel ${isDragging ? "is-dragging" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={clearPointer}
        onPointerCancel={clearPointer}
        onWheel={onWheel}
      >
        <div className="modes-carousel__track" style={{ transform: `translateX(-${activeIndex * 100}%)` }}>
          {items.map((item, index) => {
            const isActive = index === activeIndex;
            return (
              <article
                key={item.id}
                className={`mode-card ${isActive ? "mode-card--active" : "mode-card--inactive"}`}
                onClick={() => {
                  if (!isActive) {
                    onChange(index);
                    return;
                  }
                  item.onSelect?.();
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    if (!isActive) onChange(index);
                    else item.onSelect?.();
                  }
                }}
              >
                <div className="mode-card__emoji" aria-hidden="true">{item.emoji}</div>
                <div className="mode-card__title">{item.title}</div>
                <div className="mode-card__description">{item.description}</div>
                {typeof item.renderExtra === "function" ? (
                  <div className="mode-card__extra">{item.renderExtra()}</div>
                ) : null}
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
