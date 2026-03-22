import { Copyable } from "./Copyable";

interface Props {
  address: string;
  balance: string;
}

export function BuyerInfo({ address, balance }: Props) {
  return (
    <div className="wallet-bar">
      <span className="address">
        <Copyable text={address} truncate={8} />
      </span>
      <span style={{ fontFamily: "system-ui", fontSize: "0.75rem", color: "#6b5a44", flexShrink: 0 }}>
        {balance}
      </span>
    </div>
  );
}
