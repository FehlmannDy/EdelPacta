interface Props {
  steps: string[];
  current: number; // index of active step; steps.length = all done
  error?: boolean;
}

export function Stepper({ steps, current, error }: Props) {
  return (
    <div className="stepper" role="list">
      {steps.map((label, i) => {
        const isDone = i < current;
        const isActive = i === current;
        const isError = isActive && error;
        const status = isError ? "error" : isDone ? "done" : isActive ? "active" : "pending";
        const dotLabel = isError
          ? `Error on step ${i + 1}: ${label}`
          : isDone
            ? `Completed: ${label}`
            : isActive
              ? `In progress: ${label}`
              : `Pending: ${label}`;

        return (
          <div key={label} role="listitem" style={{ display: "flex", alignItems: "center" }}>
            <div className={`stepper-step stepper-step--${status}`}>
              <div className="stepper-dot" aria-label={dotLabel}>
                {isDone ? "✓" : isError ? "✕" : i + 1}
              </div>
              <span>{label}</span>
            </div>
            {i < steps.length - 1 && <div className="stepper-connector" />}
          </div>
        );
      })}
    </div>
  );
}
