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

  const activeItem = items[activeIndex] || items[0];

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
        {items.map((item, index) => {
          const isActive = index === activeIndex;
          return (
            <article
              key={item.id}
              className={`mode-card ${isActive ? "mode-card--active" : "mode-card--inactive"}`}
              onClick={() => onChange(index)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onChange(index);
                }
              }}
            >
              <div className="mode-card__emoji" aria-hidden="true">{item.emoji}</div>
              <div className="mode-card__title">{item.title}</div>
              <div className="mode-card__description">{item.description}</div>
            </article>
          );
        })}
      </div>

      <div className="modes-carousel__controls">
        <div className="modes-carousel__dots" aria-label="Выбор режима игры">
          {items.map((item, index) => (
            <button
              key={`${item.id}-dot`}
              type="button"
              className={`modes-carousel__dot ${index === activeIndex ? "is-active" : ""}`}
              onClick={() => onChange(index)}
              aria-label={item.title}
            />
          ))}
        </div>

        <button type="button" className="modes-carousel__action" onClick={activeItem?.onSelect}>
          {activeItem?.cta || "Выбрать"}
        </button>
      </div>
    </section>
  );
}
