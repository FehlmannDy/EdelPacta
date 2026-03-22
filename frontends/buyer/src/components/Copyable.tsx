import { useCopy } from "../hooks/useCopy";

interface Props {
  text: string;
  truncate?: number;
}

export function Copyable({ text, truncate }: Props) {
  const { copied, copy } = useCopy();
  const display = truncate
    ? `${text.slice(0, truncate)}…${text.slice(-truncate)}`
    : text;

  return (
    <span className="copyable" onClick={() => copy(text)} title={text}>
      {display}
      <span className={`copy-badge${copied ? " copy-badge--visible" : ""}`}>
        Copied
      </span>
    </span>
  );
}
