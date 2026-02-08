import React from "react";

export function Notifications({ items, onClose }) {
  return (
    <div id="notification-container" className="notification-container">
      {items.map((item) => (
        <div key={item.id} className={`notification ${item.type} show`}>
          <div className="notification-content">
            <span className="notification-message">{item.message}</span>
            <button
              type="button"
              className="notification-close"
              onClick={() => onClose(item.id)}
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
