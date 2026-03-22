interface Props {
  steps: string[];
  current: number;
}

export function Stepper({ steps, current }: Props) {
  return (
    <div className="stepper">
      {steps.map((label, i) => {
        const state = i < current ? "done" : i === current ? "active" : "";
        return (
          <div key={i} style={{ display: "flex", alignItems: "center" }}>
            <div className={`stepper-step${state ? ` stepper-step--${state}` : ""}`}>
              <div className="stepper-dot">{state === "done" ? "✓" : i + 1}</div>
              <span>{label}</span>
            </div>
            {i < steps.length - 1 && <div className="stepper-connector" />}
          </div>
        );
      })}
    </div>
  );
}
