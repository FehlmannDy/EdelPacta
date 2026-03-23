import { useState, useRef } from "react";
import { useWallet } from "@shared/hooks/useWallet";
import { KYCBadge } from "@shared/components/KYCBadge";
import { Modal } from "@shared/components/Modal";
import { WalletBar } from "@shared/components/WalletBar";
import { useKYCReset } from "@shared/hooks/useKYCReset";
import { KYCGate } from "./components/KYCGate";
import { MintForm } from "./components/MintForm";
import { PendingOffers, PendingOffersHandle } from "./components/PendingOffers";
import { KYCStep } from "./hooks/useKYC";
import { kycApi } from "./api/kyc";

export default function App() {
  const wallet = useWallet();
  const [kycStep, setKycStep] = useState<KYCStep | null>(null);
  const [kycKey, setKycKey] = useState(0);
  const pendingRef = useRef<PendingOffersHandle>(null);
  const { resetError, resettingKYC, handleResetKYC, resetModalOpen, setResetModalOpen } = useKYCReset(
    kycApi.deleteCredentials,
    wallet.address,
    () => {
      setKycStep(null);
      setKycKey((k) => k + 1);
    },
  );

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
            <span className="brand-tag">Notary</span>
            <h1>EdelPacta</h1>
          </div>
          <WalletBar wallet={wallet} />
        </div>
        {wallet.connected && (
          <div className="header-status">
            <KYCBadge step={kycStep} variant="notary" />
            {kycStep === "done" && (
              <>
                <button
                  onClick={() => setResetModalOpen(true)}
                  disabled={resettingKYC}
                  className="btn-secondary"
                  style={{ fontSize: "0.75rem", padding: "0.25rem 0.6rem" }}
                >
                  {resettingKYC ? "Resetting…" : "Reset KYC"}
                </button>
                {resetError && <span style={{ color: "var(--error, #c0392b)", fontSize: "0.75rem" }}>{resetError}</span>}
              </>
            )}
          </div>
        )}
      </header>

      <main>
        {!wallet.connected ? (
          <div className="welcome">
            <p className="welcome-icon">🏛️</p>
            <p className="welcome-title">Title Registry</p>
            <p className="welcome-subtitle">
              Certify and issue property title deeds as on-chain records,
              immutably registered on the XRP Ledger.
            </p>
            <button onClick={wallet.connect} style={{ marginTop: "1rem" }}>
              Connect Otsu Wallet →
            </button>
          </div>
        ) : (
          <KYCGate key={kycKey} address={wallet.address!} sign={wallet.sign} onStep={setKycStep}>
            <MintForm onMinted={() => pendingRef.current?.load()} />
            <PendingOffers ref={pendingRef} />
          </KYCGate>
        )}
      </main>
    </div>
  );
}
