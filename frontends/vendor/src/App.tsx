import { KYCBadge } from "@shared/components/KYCBadge";
import { Modal } from "@shared/components/Modal";
import { WalletBar } from "@shared/components/WalletBar";
import { useKYCReset } from "@shared/hooks/useKYCReset";
import { useWallet } from "@shared/hooks/useWallet";
import { useRef, useState } from "react";
import { kycApi } from "./api/kyc";
import { IncomingOffers } from "./components/IncomingOffers";
import { KYCGate } from "./components/KYCGate";
import { OwnedNFTs, OwnedNFTsHandle } from "./components/OwnedNFTs";
import { PendingEscrows } from "./components/PendingEscrows";
import { SuccessfulEscrows } from "./components/SuccessfulEscrows";
import { KYCStep } from "./hooks/useKYC";

export default function App() {
  const wallet = useWallet();
  const ownedNFTsRef = useRef<OwnedNFTsHandle>(null);
  const [kycStep, setKycStep] = useState<KYCStep | null>(null);
  const [kycKey, setKycKey] = useState(0);
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
      <header>
        <div className="header-top">
          <div className="header-brand">
            <span className="brand-tag">Vendor</span>
            <h1>EdelPacta</h1>
          </div>
          <WalletBar wallet={wallet} />
        </div>
        {wallet.connected && (
          <div className="header-status">
            <KYCBadge step={kycStep} variant="vendor" />
            {kycStep === "done" && (
              <>
                <Modal
                  open={resetModalOpen}
                  title="Reset KYC"
                  danger
                  message="This will delete your verified credentials. You will need to complete identity verification again before using EdelPacta."
                  confirmLabel="Reset"
                  onConfirm={() => { setResetModalOpen(false); void handleResetKYC(); }}
                  onCancel={() => setResetModalOpen(false)}
                />
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
            <p className="welcome-icon">🏠</p>
            <p className="welcome-title">Property Transfer Portal</p>
            <p className="welcome-subtitle">
              Accept the on-chain transfer of your property title deed,
              secured and verified on the XRP Ledger.
            </p>
            <button onClick={wallet.connect} style={{ marginTop: "1rem" }}>
              Connect Otsu Wallet →
            </button>
          </div>
        ) : (
          <KYCGate key={kycKey} address={wallet.address!} sign={wallet.sign} onStep={setKycStep}>
            <IncomingOffers address={wallet.address!} sign={wallet.sign} onAccepted={() => ownedNFTsRef.current?.load()} />
            <OwnedNFTs ref={ownedNFTsRef} address={wallet.address!} sign={wallet.sign} />
            <PendingEscrows address={wallet.address!} sign={wallet.sign} onDeedUpdate={() => ownedNFTsRef.current?.load()} />
            <SuccessfulEscrows address={wallet.address!} />
          </KYCGate>
        )}
      </main>
    </div>
  );
}
