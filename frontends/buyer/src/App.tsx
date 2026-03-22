import { useRef, useState } from "react";
import { useWallet } from "./hooks/useWallet";
import { KYCGate } from "./components/KYCGate";
import { KYCStep } from "./hooks/useKYC";
import { CreateEscrowResult } from "./api/escrow";
import { EscrowCreate } from "./components/EscrowCreate";
import { EscrowFinish } from "./components/EscrowFinish";
import { AcceptNft } from "./components/AcceptNft";
import { OwnedNFTs, OwnedNFTsHandle } from "./components/OwnedNFTs";
import { Copyable } from "./components/Copyable";

type FlowStep = "create" | "finish" | "accept" | "done";

const FLOW_LABELS = ["1. Lock XRP", "2. Finalize", "3. Accept NFT", "4. Done"];
const FLOW_STEPS: FlowStep[] = ["create", "finish", "accept", "done"];

function KYCBadge({ step }: { step: KYCStep | null }) {
  if (!step || step === "checking") return null;
  if (step === "done") {
    return (
      <span className="kyc-badge kyc-badge--done" title="Identity verified on XRPL">
        🛡 Verified
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

  const [flowStep, setFlowStep] = useState<FlowStep>("create");
  const [escrowResult, setEscrowResult] = useState<(CreateEscrowResult & { nftId: string; amountRlusd: number }) | null>(null);

  const nftsRef = useRef<OwnedNFTsHandle>(null);

  const handleEscrowCreated = (result: CreateEscrowResult & { nftId: string; amountRlusd: number }) => {
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

  // Reset KYC key when wallet disconnects so it re-checks on next connect
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

          {wallet.connected && wallet.address ? (
            <div className="wallet-bar">
              <span className="address">
                <Copyable text={wallet.address} truncate={8} />
              </span>
              <div className="wallet-actions">
                <button
                  className="btn-secondary"
                  onClick={wallet.switchWallet}
                  style={{ fontSize: "0.65rem", padding: "0.25rem 0.6rem" }}
                >
                  Switch
                </button>
                <button
                  className="btn-secondary"
                  onClick={handleDisconnect}
                  style={{ fontSize: "0.65rem", padding: "0.25rem 0.6rem" }}
                >
                  Disconnect
                </button>
              </div>
            </div>
          ) : (
            <button onClick={wallet.connect} style={{ fontSize: "0.8rem", padding: "0.4rem 1rem" }}>
              Connect Otsu Wallet
            </button>
          )}
        </div>

        {wallet.connected && (
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
            <KYCBadge step={kycStep} />
            {kycStep === "done" && FLOW_STEPS.map((s, i) => {
              const currentIdx = FLOW_STEPS.indexOf(flowStep);
              const isDone = currentIdx > i;
              const isActive = flowStep === s;
              return (
                <span key={s} style={{
                  fontFamily: "system-ui", fontSize: "0.62rem", fontWeight: 700,
                  letterSpacing: "0.12em", textTransform: "uppercase",
                  color: isDone ? "#4a7a50" : isActive ? "#6b1728" : "#c8bfb2",
                }}>
                  {i > 0 && <span style={{ margin: "0 0.4rem", color: "#c8bfb2" }}>›</span>}
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
              <EscrowCreate onCreated={handleEscrowCreated} />
            )}

            {flowStep === "finish" && escrowResult && (
              <EscrowFinish escrow={escrowResult} onFinished={handleFinished} />
            )}

            {flowStep === "accept" && wallet.address && (
              <AcceptNft
                buyerAddress={wallet.address}
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
              <OwnedNFTs ref={nftsRef} address={wallet.address} />
            )}
          </KYCGate>
        )}
      </main>
    </div>
  );
}
