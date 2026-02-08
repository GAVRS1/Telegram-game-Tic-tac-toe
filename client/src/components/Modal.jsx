import React from "react";

export function Modal({ open, title, content, primary, secondary }) {
  if (!open) return null;

  const primaryConfig = primary || {};
  const secondaryConfig = secondary || {};

  return (
    <div className="modal show" id="modal">
      <div className="box">
        <h3 id="modalTitle">{title || "Сообщение"}</h3>
        <div className="body" id="modalBody">
          {Array.isArray(content)
            ? content.map((node, index) => (
                <React.Fragment key={index}>{node}</React.Fragment>
              ))
            : content}
        </div>
        <div className="row" style={{ justifyContent: "center", gap: "10px" }}>
          {primaryConfig.show !== false && (
            <button className="btn primary" id="modalPrimary" onClick={primaryConfig.onClick}>
              {primaryConfig.label || "ОК"}
            </button>
          )}
          {secondaryConfig.show !== false && (
            <button className="btn" id="modalSecondary" onClick={secondaryConfig.onClick}>
              {secondaryConfig.label || "Закрыть"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
