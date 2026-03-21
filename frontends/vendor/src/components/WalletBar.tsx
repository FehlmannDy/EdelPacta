import { WalletState } from "../hooks/useWallet";
import { Copyable } from "./Copyable";

interface Props {
  wallet: WalletState & { connect: () => void; disconnect: () => void; switchWallet: () => void };
}

export function WalletBar({ wallet }: Props) {
  return (
    <div className="wallet-bar">
      {wallet.connected ? (
        <>
          <Copyable text={wallet.address!} className="address">{wallet.address}</Copyable>
          <div className="wallet-actions">
            <button onClick={wallet.switchWallet} className="btn-secondary">Switch Wallet</button>
            <button onClick={wallet.disconnect}>Disconnect</button>
          </div>
        </>
      ) : (
        <div className="wallet-actions">
          <button onClick={wallet.connect}>Connect Otsu Wallet</button>
        </div>
      )}
      {wallet.error && <span className="error">{wallet.error}</span>}
    </div>
  );
}
