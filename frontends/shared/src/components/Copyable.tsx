import { useCopy } from "../hooks/useCopy";

interface Props {
  text: string;
  truncate?: number; // show first n…last n chars
  children?: React.ReactNode;
  className?: string;
}

function truncateMiddle(s: string, n: number) {
  if (s.length <= n * 2 + 3) return s;
  return `${s.slice(0, n)}…${s.slice(-n)}`;
}

export function Copyable({ text, truncate, children, className }: Props) {
  const { copy, copied } = useCopy();
  const display = children ?? (truncate ? truncateMiddle(text, truncate) : text);

  return (
    <span
      className={`copyable${className ? ` ${className}` : ""}`}
      onClick={() => copy(text)}
      title={truncate ? text : "Click to copy"}
    >
      {copied ? "✓ Copied" : display}
      <span
        aria-live="polite"
        style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)" }}
      >
        {copied ? "Copied to clipboard" : ""}
      </span>
    </span>
  );
}
