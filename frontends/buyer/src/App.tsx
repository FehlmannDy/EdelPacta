import { useRef, useState } from "react";
import { useWallet } from "@shared/hooks/useWallet";
import { WalletBar } from "@shared/components/WalletBar";
import { KYCGate } from "./components/KYCGate";
import { KYCStep } from "./hooks/useKYC";
import { kycApi } from "./api/kyc";
import { CreateEscrowResult } from "./api/escrow";
import { EscrowCreate } from "./components/EscrowCreate";
import { EscrowFinish } from "./components/EscrowFinish";
import { AcceptNft } from "./components/AcceptNft";
import { OwnedNFTs, OwnedNFTsHandle } from "./components/OwnedNFTs";
import { PendingEscrows } from "./components/PendingEscrows";

type FlowStep = "create" | "finish" | "accept" | "done";

const FLOW_LABELS = ["1. Lock XRP", "2. Finalize", "3. Accept NFT", "4. Done"];
const FLOW_STEPS: FlowStep[] = ["create", "finish", "accept", "done"];

function KYCBadge({ step }: { step: KYCStep | null }) {
  if (!step || step === "checking") return null;
  if (step === "done") {
    return (
      <span className="kyc-badge kyc-badge--done" title="Identity verified on XRPL">
        🪪 ID Verified
      </span>
    );
  }
  return (
    <span className="kyc-badge kyc-badge--pending" title="KYC in progress">
      ⏳ KYC…
    </span>
  );
}

export default function App() {
  const wallet = useWallet();
  const [kycStep, setKycStep] = useState<KYCStep | null>(null);
  const [kycKey, setKycKey] = useState(0);
  const [resettingKYC, setResettingKYC] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const [flowStep, setFlowStep] = useState<FlowStep>("create");
  const [escrowResult, setEscrowResult] = useState<(CreateEscrowResult & { nftId: string; amountXrp: number }) | null>(null);

  const nftsRef = useRef<OwnedNFTsHandle>(null);

  const handleEscrowCreated = (result: CreateEscrowResult & { nftId: string; amountXrp: number }) => {
    setEscrowResult(result);
    setFlowStep("finish");
  };

  const handleFinished = (_hash: string) => {
    setFlowStep("accept");
  };

  const handleNftAccepted = () => {
    setFlowStep("done");
    nftsRef.current?.load();
  };

  const handleNewPurchase = () => {
    setFlowStep("create");
    setEscrowResult(null);
  };

  const handleResumeEscrow = (escrow: import("./api/escrow").EscrowObject) => {
    const result: CreateEscrowResult & { nftId: string; amountXrp: number } = {
      escrowSequence: escrow.Sequence,
      hash: "",
      escrowAccount: escrow.Account,
      buyerAddress: wallet.address!,
      cancelAfter: escrow.CancelAfter ?? 0,
      nftId: escrow.NftId ?? "",
      amountXrp: parseInt(escrow.Amount, 10) / 1_000_000,
    };
    handleEscrowCreated(result);
  };

  const handleResetKYC = async () => {
    if (!wallet.address || resettingKYC) return;
    setResettingKYC(true);
    setResetError(null);
    try {
      await kycApi.deleteCredentials(wallet.address);
      setKycStep(null);
      setKycKey((k) => k + 1);
      setFlowStep("create");
      setEscrowResult(null);
    } catch (err) {
      setResetError(err instanceof Error ? err.message : "Failed to reset KYC");
    } finally {
      setResettingKYC(false);
    }
  };

  const handleDisconnect = () => {
    wallet.disconnect();
    setKycStep(null);
    setKycKey((k) => k + 1);
    setFlowStep("create");
    setEscrowResult(null);
  };

  return (
    <div className="app">
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
            <KYCBadge step={kycStep} />
            {kycStep === "done" && (
              <button
                onClick={handleResetKYC}
                disabled={resettingKYC}
                className="btn-secondary"
                style={{ fontSize: "0.65rem", padding: "0.25rem 0.6rem" }}
              >
                {resettingKYC ? "Resetting…" : "Reset KYC"}
              </button>
            )}
            {resetError && <span className="field-error">{resetError}</span>}
            {kycStep === "done" && FLOW_STEPS.map((s, i) => {
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
          <KYCGate key={kycKey} address={wallet.address!} sign={wallet.sign} onStep={setKycStep}>
            {flowStep === "create" && (
              <EscrowCreate
                buyerAddress={wallet.address!}
                sign={wallet.sign}
                onCreated={handleEscrowCreated}
              />
            )}

            {flowStep === "finish" && escrowResult && (
              <EscrowFinish escrow={escrowResult} onFinished={handleFinished} />
            )}

            {flowStep === "accept" && wallet.address && (
              <AcceptNft
                buyerAddress={wallet.address}
                nftId={escrowResult?.nftId}
                sign={wallet.sign}
                onAccepted={handleNftAccepted}
              />
            )}

            {flowStep === "done" && (
              <div className="form-card">
                <h2>Settlement Complete</h2>
                <p className="info" style={{ fontSize: "0.85rem", lineHeight: 1.7 }}>
                  The atomic settlement is complete. The seller received the XRP and
                  you now hold the property title deed on-chain.
                </p>
                <button className="btn-secondary" onClick={handleNewPurchase}>
                  New Purchase
                </button>
              </div>
            )}

            {wallet.address && (
              <PendingEscrows address={wallet.address} onResume={handleResumeEscrow} />
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
