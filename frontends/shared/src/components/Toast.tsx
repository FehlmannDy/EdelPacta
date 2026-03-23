import { useToast } from "../context/ToastContext";

const ICONS = { success: "✓", error: "✕", info: "·" };

export function ToastContainer() {
  const { toasts, removeToast } = useToast();

  return (
    <div className="toast-container" role="region" aria-live="polite" aria-label="Notifications">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast--${t.type}`} onClick={() => removeToast(t.id)}>
          <span className="toast-icon">{ICONS[t.type]}</span>
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}
