import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

const SWIPE_THRESHOLD = 35;
const WHEEL_THRESHOLD = 45;

export function GameModesCarousel({ items, activeIndex, onChange }) {
  const pointerStateRef = useRef({ id: null, startX: 0, dragging: false });
  const wheelCarryRef = useRef(0);
  const [isDragging, setIsDragging] = useState(false);
  const [visualIndex, setVisualIndex] = useState(activeIndex + 1);
  const [isTransitionEnabled, setIsTransitionEnabled] = useState(true);

  const itemCount = Array.isArray(items) ? items.length : 0;
  const normalizedVisualIndex = ((visualIndex - 1 + itemCount) % itemCount + itemCount) % itemCount;
  const renderItems = useMemo(() => {
    if (!itemCount) return [];
    const first = items[0];
    const last = items[itemCount - 1];
    return [last, ...items, first];
  }, [itemCount, items]);

  useEffect(() => {
    if (!itemCount) return;
    const nextVisual = activeIndex + 1;
    setIsTransitionEnabled(true);
    setVisualIndex(nextVisual);
  }, [activeIndex, itemCount]);

  const move = useCallback(
    (delta) => {
      if (itemCount <= 0 || typeof onChange !== "function") return;
      setIsTransitionEnabled(true);
      setVisualIndex((current) => current + delta);
    },
    [itemCount, onChange]
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

  const handleTrackTransitionEnd = useCallback(() => {
    if (!itemCount) return;

    if (visualIndex === 0) {
      setIsTransitionEnabled(false);
      setVisualIndex(itemCount);
      return;
    }

    if (visualIndex === itemCount + 1) {
      setIsTransitionEnabled(false);
      setVisualIndex(1);
      return;
    }

    if (typeof onChange === "function" && normalizedVisualIndex !== activeIndex) {
      onChange(normalizedVisualIndex);
    }
  }, [activeIndex, itemCount, normalizedVisualIndex, onChange, visualIndex]);

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
        <div
          className="modes-carousel__track"
          style={{
            transform: `translateX(-${visualIndex * 100}%)`,
            transition: isTransitionEnabled ? undefined : "none",
          }}
          onTransitionEnd={handleTrackTransitionEnd}
        >
          {renderItems.map((item, visualItemIndex) => {
            const index = ((visualItemIndex - 1 + itemCount) % itemCount + itemCount) % itemCount;
            const isActive = index === activeIndex;
            return (
              <article
                key={`${item.id}-${visualItemIndex}`}
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
                <div className="mode-card__media" aria-hidden="true">
                  {item.image ? <img src={item.image} alt="" className="mode-card__image" /> : null}
                </div>
                <div className="mode-card__title-row">
                  <div className="mode-card__title">{item.title}</div>
                  {isActive ? <span className="mode-card__chip">Активно</span> : null}
                </div>
                <div className="mode-card__description">{item.description}</div>
                {typeof item.renderExtra === "function" ? (
                  <div className="mode-card__extra">{item.renderExtra()}</div>
                ) : (
                  <div className="mode-card__extra">
                    <button type="button" className="mode-card__cta" onClick={(event) => {
                      event.stopPropagation();
                      item.onSelect?.();
                    }}>
                      Выбрать режим
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </div>
      <div className="modes-carousel__dots" aria-hidden="true">
        {items.map((item, index) => {
          const active = index === normalizedVisualIndex;
          return (
            <button
              key={`dot-${item.id}`}
              type="button"
              className={`modes-carousel__dot ${active ? "is-active" : ""}`}
              onClick={() => onChange(index)}
              aria-label={`Перейти к режиму ${item.title}`}
            />
          );
        })}
      </div>
    </section>
  );
}
