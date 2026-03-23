import { KYCBadge } from "@shared/components/KYCBadge";
import { Modal } from "@shared/components/Modal";
import { WalletBar } from "@shared/components/WalletBar";
import { useToast } from "@shared/context/ToastContext";
import { useKYCReset } from "@shared/hooks/useKYCReset";
import { useWallet } from "@shared/hooks/useWallet";
import { useCallback, useRef, useState } from "react";
import { CreateEscrowResult } from "./api/escrow";
import { kycApi } from "./api/kyc";
import { AcceptAndFinalizeEscrow } from "./components/AcceptAndFinalizeEscrow";
import { EscrowCreate } from "./components/EscrowCreate";
import { KYCGate } from "./components/KYCGate";
import { OwnedNFTs, OwnedNFTsHandle } from "./components/OwnedNFTs";
import { PendingEscrows } from "./components/PendingEscrows";
import { KYCStep } from "./hooks/useKYC";

type FlowStep = "create" | "settle" | "done";

const FLOW_LABELS = ["1. Lock XRP", "2. Accept + Finalize", "3. Done"];
const FLOW_STEPS: FlowStep[] = ["create", "settle", "done"];

export default function App() {
  const wallet = useWallet();
  const { addToast } = useToast();
  const [kycStep, setKycStep] = useState<KYCStep | null>(null);
  const [kycKey, setKycKey] = useState(0);

  const [flowStep, setFlowStep] = useState<FlowStep>("create");
  const [escrowResult, setEscrowResult] = useState<(CreateEscrowResult & { nftId: string; amountXrp: number }) | null>(null);

  const nftsRef = useRef<OwnedNFTsHandle>(null);

  const handleEscrowCreated = (result: CreateEscrowResult & { nftId: string; amountXrp: number }) => {
    setEscrowResult(result);
    setFlowStep("settle");
  };

  const handleFinished = (_hash: string) => {
    setFlowStep("done");
    nftsRef.current?.load();
  };

  const handleNewPurchase = () => {
    setFlowStep("create");
    setEscrowResult(null);
  };

  const handleResumeEscrow = (escrow: import("./api/escrow").EscrowObject) => {
    const nftId = escrow.NftId ?? "";
    // BUYER-006: validate required fields before transitioning to settle step
    if (!nftId) {
      addToast("Cannot resume: escrow is missing NFT ID. Please wait for the vendor to initiate a transfer.", "error");
      return;
    }
    const result: CreateEscrowResult & { nftId: string; amountXrp: number } = {
      escrowSequence: escrow.Sequence,
      hash: "",
      escrowAccount: escrow.Account,
      buyerAddress: wallet.address!,
      cancelAfter: escrow.CancelAfter ?? 0,
      nftId,
      amountXrp: parseInt(escrow.Amount, 10) / 1_000_000,
    };
    handleEscrowCreated(result);
  };

  // BUYER-011: reject sign calls immediately if wallet is no longer connected
  const safeSign = useCallback(async (tx: Record<string, unknown>): Promise<string> => {
    if (!wallet.connected) throw new Error("Wallet disconnected. Please reconnect and try again.");
    return wallet.sign(tx);
  }, [wallet.connected, wallet.sign]);

  const { resetError, resettingKYC, handleResetKYC, resetModalOpen, setResetModalOpen } = useKYCReset(
    kycApi.deleteCredentials,
    wallet.address,
    () => {
      setKycStep(null);
      setKycKey((k) => k + 1);
      setFlowStep("create");
      setEscrowResult(null);
    },
  );

  const handleDisconnect = () => {
    wallet.disconnect();
    setKycStep(null);
    setKycKey((k) => k + 1);
    setFlowStep("create");
    setEscrowResult(null);
  };

  return (
    <div className="app">
      <Modal
        open={resetModalOpen}
        title="Reset KYC"
        danger
        message="Reset your KYC credentials? You will need to re-verify your identity."
        confirmLabel="Reset"
        onConfirm={() => { setResetModalOpen(false); handleResetKYC(); }}
        onCancel={() => setResetModalOpen(false)}
      />
      <header>
        <div className="header-top">
          <div className="header-brand">
            <span className="brand-tag">Buyer</span>
            <h1>EdelPacta</h1>
          </div>
          <WalletBar wallet={{ ...wallet, disconnect: handleDisconnect }} />
        </div>

        {wallet.connected && (
          <div className="header-status">
            <KYCBadge step={kycStep} variant="buyer" />
            {kycStep === "done" && (
              <button
                onClick={() => setResetModalOpen(true)}
                disabled={resettingKYC}
                className="btn-secondary"
                style={{ fontSize: "0.65rem", padding: "0.25rem 0.6rem" }}
              >
                {resettingKYC ? "Resetting…" : "Reset KYC"}
              </button>
            )}
            {resetError && <span className="field-error">{resetError}</span>}
            {kycStep === "done" && (
              <div className="header-flow" aria-label="Purchase flow progress">
                {FLOW_STEPS.map((s, i) => {
                  const currentIdx = FLOW_STEPS.indexOf(flowStep);
                  const isDone = flowStep === "done" || currentIdx > i;
                  const isActive = flowStep !== "done" && flowStep === s;
                  return (
                    <span key={s} className={`kyc-badge${isDone ? " kyc-badge--done" : isActive ? " kyc-badge--pending" : ""}`}
                      style={{ borderColor: isDone || isActive ? undefined : "#c8bfb2", color: isDone || isActive ? undefined : "#c8bfb2" }}>
                      {i > 0 && <span style={{ marginRight: "0.3rem", opacity: 0.5 }}>›</span>}
                      {FLOW_LABELS[i]}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </header>

      <main>
        {!wallet.connected ? (
          <div className="welcome">
            <p className="welcome-icon">🏠</p>
            <p className="welcome-title">Property Purchase Portal</p>
            <p className="welcome-subtitle">
              Buy property title deeds on-chain using a WASM-secured smart escrow
              on the XRP Ledger.
            </p>
            {wallet.error && <p className="error">{wallet.error}</p>}
            <button onClick={wallet.connect} style={{ marginTop: "1.5rem" }}>
              Connect Otsu Wallet →
            </button>
          </div>
        ) : (
          <KYCGate key={kycKey} address={wallet.address!} sign={safeSign} onStep={setKycStep}>
            {flowStep === "create" && (
              <EscrowCreate
                buyerAddress={wallet.address!}
                sign={safeSign}
                onCreated={handleEscrowCreated}
              />
            )}

            {flowStep === "settle" && wallet.address && escrowResult && (
              <AcceptAndFinalizeEscrow
                buyerAddress={wallet.address}
                sign={safeSign}
                escrow={escrowResult}
                onFinished={handleFinished}
              />
            )}

            {flowStep === "done" && (
              <div className="form-card">
                <h2>Settlement Complete</h2>
                <p className="info" style={{ fontSize: "0.85rem", lineHeight: 1.7 }}>
                  The atomic settlement is complete. The vendor received the XRP and
                  you now hold the property title deed on-chain.
                </p>
                <button className="btn-secondary" onClick={handleNewPurchase}>
                  New Purchase
                </button>
              </div>
            )}

            {wallet.address && (
              <PendingEscrows address={wallet.address} sign={safeSign} onResume={handleResumeEscrow} />
            )}

            {wallet.address && (
              <OwnedNFTs ref={nftsRef} address={wallet.address} />
            )}
          </KYCGate>
        )}
      </main>
    </div>
  );
}
