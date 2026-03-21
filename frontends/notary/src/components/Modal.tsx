interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
}

export function Modal({ open, title, message, confirmLabel = "Confirm", onConfirm, onCancel, danger }: Props) {
  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className={danger ? "modal-title--danger" : ""}>{title}</h3>
        <p style={{ fontFamily: "system-ui, sans-serif", fontSize: "0.88rem", color: "#5a4a38", lineHeight: 1.6 }}>
          {message}
        </p>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onCancel}>Cancel</button>
          <button
            onClick={onConfirm}
            style={danger ? { background: "#9b2a2a", borderColor: "#9b2a2a" } : undefined}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
