import { useState, useRef } from "react";
import { useWallet } from "@shared/hooks/useWallet";
import { WalletBar } from "@shared/components/WalletBar";
import { KYCGate } from "./components/KYCGate";
import { Vendor } from "./components/Vendor";
import { OwnedNFTs, OwnedNFTsHandle } from "./components/OwnedNFTs";
import { IncomingOffers, IncomingOffersHandle } from "./components/IncomingOffers";
import { KYCStep } from "./hooks/useKYC";
import { kycApi } from "./api/kyc";

function KYCBadge({ step }: { step: KYCStep | null }) {
  if (!step || step === "checking") return null;
  if (step === "done") {
    return (
      <>
        <span className="kyc-badge kyc-badge--done" title="Swiss e-ID verified on XRPL">
          🪪 ID Verified
        </span>
        <span className="kyc-badge kyc-badge--done kyc-badge--estate" title="Estate credential verified on XRPL">
          🏠 Estate Verified
        </span>
      </>
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
  const ownedRef = useRef<OwnedNFTsHandle>(null);
  const incomingRef = useRef<IncomingOffersHandle>(null);

  const handleResetKYC = async () => {
    if (!wallet.address || resettingKYC) return;
    setResettingKYC(true);
    setResetError(null);
    try {
      await kycApi.deleteCredentials(wallet.address);
      setKycStep(null);
      setKycKey((k) => k + 1);
    } catch (err) {
      setResetError(err instanceof Error ? err.message : "Failed to reset KYC");
    } finally {
      setResettingKYC(false);
    }
  };

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
            <KYCBadge step={kycStep} />
            {kycStep === "done" && (
              <>
                <button
                  onClick={handleResetKYC}
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
            <OwnedNFTs ref={ownedRef} address={wallet.address!} sign={wallet.sign} />
            <IncomingOffers
              ref={incomingRef}
              address={wallet.address!}
              sign={wallet.sign}
              onAccepted={() => ownedRef.current?.load()}
            />
            <Vendor
              address={wallet.address!}
              sign={wallet.sign}
              onAccepted={() => { ownedRef.current?.load(); incomingRef.current?.load(); }}
            />
          </KYCGate>
        )}
      </main>
    </div>
  );
}
