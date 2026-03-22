import { useState, useCallback, useEffect } from "react";
import { walletLog } from "../logger";

// Otsu Wallet injects window.xrpl with isOtsu = true
interface OtsuProvider {
  isOtsu: true;
  isConnected(): boolean;
  connect(): Promise<{ address: string }>;
  disconnect(): Promise<void>;
  getAddress(): Promise<string>;
  signTransaction(tx: Record<string, unknown>): Promise<{ tx_blob: string }>;
  on(event: "accountChanged" | "networkChanged" | "connect" | "disconnect", cb: (data: unknown) => void): void;
  off(event: "accountChanged" | "networkChanged" | "connect" | "disconnect", cb: (data: unknown) => void): void;
}

declare global {
  interface Window {
    xrpl?: OtsuProvider;
  }
}

function getProvider(): OtsuProvider | null {
  if (typeof window !== "undefined" && window.xrpl?.isOtsu) {
    return window.xrpl;
  }
  return null;
}

export interface WalletState {
  connected: boolean;
  address: string | null;
  error: string | null;
}

function isLockError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return msg.includes("lock") || msg.includes("unauthorized") || msg.includes("not connected") || msg.includes("user rejected");
}

export function useWallet() {
  const [state, setState] = useState<WalletState>({
    connected: false,
    address: null,
    error: null,
  });

  const handleLocked = useCallback((msg = "Wallet is locked. Please unlock it in the Otsu extension.") => {
    walletLog.warn("wallet locked / disconnected", { msg });
    setState({ connected: false, address: null, error: msg });
  }, []);

  // On mount: verify the extension is actually unlocked and still connected
  useEffect(() => {
    const provider = getProvider();
    if (!provider || !provider.isConnected()) return;

    provider.getAddress().then((address) => {
      if (address) {
        walletLog.info("wallet already connected", { address });
        setState({ connected: true, address, error: null });
      }
    }).catch((err) => {
      walletLog.warn("wallet unlock check failed", { err });
      handleLocked();
    });
  }, []);

  // Listen to account changes and disconnects from the extension
  useEffect(() => {
    const provider = getProvider();
    if (!provider) return;

    const onAccountChanged = (data: unknown) => {
      const address = (data as { address?: string })?.address ?? null;
      if (address) {
        walletLog.info("account changed", { address });
        setState({ connected: true, address, error: null });
      } else {
        handleLocked();
      }
    };

    const onDisconnect = () => {
      walletLog.info("wallet disconnected via extension event");
      handleLocked();
    };

    provider.on("accountChanged", onAccountChanged);
    provider.on("disconnect", onDisconnect);
    return () => {
      provider.off("accountChanged", onAccountChanged);
      provider.off("disconnect", onDisconnect);
    };
  }, []);

  const connect = useCallback(async () => {
    setState((s) => ({ ...s, error: null }));

    const provider = getProvider();
    if (!provider) {
      walletLog.error("Otsu Wallet extension not detected");
      setState((s) => ({
        ...s,
        error: "Otsu Wallet extension not detected. Install it from the Chrome or Firefox store.",
      }));
      return;
    }

    try {
      walletLog.info("connecting wallet...");
      const { address } = await provider.connect();
      if (!address) {
        walletLog.warn("connect returned no address");
        setState((s) => ({ ...s, error: "Could not get address from wallet." }));
        return;
      }
      walletLog.info("wallet connected", { address });
      setState({ connected: true, address, error: null });
    } catch (err) {
      walletLog.error("wallet connect failed", { err });
      handleLocked(err instanceof Error ? err.message : "Failed to connect wallet.");
    }
  }, []);

  // Disconnect then reconnect — opens the wallet picker again
  const switchWallet = useCallback(async () => {
    const provider = getProvider();
    if (!provider) return;
    try {
      walletLog.info("switching wallet...");
      await provider.disconnect();
      const { address } = await provider.connect();
      if (address) {
        walletLog.info("wallet switched", { address });
        setState({ connected: true, address, error: null });
      }
    } catch (err) {
      walletLog.error("wallet switch failed", { err });
      handleLocked(err instanceof Error ? err.message : "Failed to switch wallet.");
    }
  }, []);

  const disconnect = useCallback(async () => {
    walletLog.info("disconnecting wallet");
    await getProvider()?.disconnect();
    setState({ connected: false, address: null, error: null });
  }, []);

  const sign = useCallback(async (tx: Record<string, unknown>): Promise<string> => {
    const provider = getProvider();
    if (!provider) throw new Error("Wallet not connected.");

    try {
      walletLog.debug("signing transaction", { TransactionType: tx["TransactionType"] });
      const { tx_blob } = await provider.signTransaction(tx);
      if (!tx_blob) throw new Error("Wallet rejected the transaction.");
      walletLog.info("transaction signed");
      return tx_blob;
    } catch (err) {
      if (isLockError(err)) {
        walletLog.warn("sign failed — wallet locked", { err });
        handleLocked();
        throw new Error("Wallet is locked. Please unlock it in the Otsu extension and try again.");
      }
      walletLog.error("sign failed", { err });
      throw err;
    }
  }, []);

  return { ...state, connect, disconnect, switchWallet, sign };
}
