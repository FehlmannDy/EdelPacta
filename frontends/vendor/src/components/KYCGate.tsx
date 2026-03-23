import { QRCodeSVG } from "qrcode.react";
import { useKYC, KYCStep } from "../hooks/useKYC";
import { submitTx } from "../api/nft";
import { useEffect, useState } from "react";

interface Props {
  address: string;
  sign: (tx: Record<string, unknown>) => Promise<string>;
  children: React.ReactNode;
  onStep?: (step: KYCStep) => void;
}

function getProgress(step: KYCStep, verificationStep: "identity" | "tax" | null): number {
  const isTax = verificationStep === "tax";
  if (step === "scanning")  return isTax ? 60 : 20;
  if (step === "issuing")   return isTax ? 80 : 45;
  if (step === "accepting") return isTax ? 90 : 58;
  return 8; // start
}

export function KYCGate({ address, sign, children, onStep }: Props) {
  const kyc = useKYC(address, sign, submitTx);
  const [starting, setStarting] = useState(false);
  const [scanWarning, setScanWarning] = useState(false);

  useEffect(() => { onStep?.(kyc.step); }, [kyc.step, onStep]);

  useEffect(() => {
    if (kyc.step !== "scanning") {
      setScanWarning(false);
      return;
    }
    const id = setTimeout(() => setScanWarning(true), 2 * 60 * 1000);
    return () => clearTimeout(id);
  }, [kyc.step]);

  useEffect(() => {
    if (kyc.step !== "start") setStarting(false);
  }, [kyc.step]);

  if (kyc.step === "done") return <>{children}</>;

  if (kyc.step === "checking") {
    return (
      <div className="kyc-overlay">
        <div className="kyc-checking">
          <div className="spinner" />
          <p className="kyc-checking-text">Checking credentials…</p>
        </div>
      </div>
    );
  }

  const stepNum = kyc.verificationStep === "tax" ? 2 : 1;
  const progress = getProgress(kyc.step, kyc.verificationStep);

  const phase1 = kyc.step === "start"
    ? "upcoming"
    : kyc.verificationStep === "identity" ? "active" : "done";
  const phase2 = kyc.verificationStep === "tax" ? "active" : "upcoming";

  return (
    <div className="kyc-overlay">
      <div className="form-card kyc-card">

        {/* Header */}
        <div className="kyc-card-header">
          <h2>Identity Verification</h2>
          <p className="kyc-tagline">One-time check required to use EdelPacta</p>
        </div>

        {/* Progress & phase indicators */}
        {kyc.step !== "error" && (
          <>
            <div className="progress-bar-wrap">
              <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
            </div>
            <div className="kyc-phases">
              <div className={`kyc-phase kyc-phase--${phase1}`}>
                <span className="kyc-phase-num">
                  {phase1 === "done" ? "✓" : "1"}
                </span>
                <span>Swiss e-ID</span>
              </div>
              <div className="kyc-phase-connector" />
              <div className={`kyc-phase kyc-phase--${phase2}`}>
                <span className="kyc-phase-num">2</span>
                <span>Estate Credential</span>
              </div>
            </div>
          </>
        )}

        {/* ── START ── */}
        {kyc.step === "start" && (
          <div className="kyc-start">
            <p className="info" style={{ fontSize: "0.88rem", lineHeight: 1.75 }}>
              Before receiving property title deeds, we need to verify your identity and estate ownership.
              This is a two-step process using your Swiss digital credentials.
            </p>
            <ul className="kyc-requirements">
              <li>
                <span className="kyc-req-icon">📱</span>
                <span>Your <strong>SWIYU</strong> or <strong>eID</strong> wallet app installed on your phone</span>
              </li>
              <li>
                <span className="kyc-req-icon">🪪</span>
                <span>A valid <strong>Swiss e-ID</strong> credential</span>
              </li>
              <li>
                <span className="kyc-req-icon">🏠</span>
                <span>Your <strong>Estate</strong> ownership credential</span>
              </li>
            </ul>
            <button
              onClick={() => { setStarting(true); kyc.startKYC(); }}
              disabled={starting}
            >
              {starting ? (
                <><span className="spinner spinner--sm spinner--inline" /> Starting…</>
              ) : "Begin Verification"}
            </button>
          </div>
        )}

        {/* ── SCANNING ── */}
        {kyc.step === "scanning" && (
          <div className="kyc-scan-panel">
            <p className="kyc-scan-subtitle">
              Step {stepNum} of 2 — {stepNum === 1 ? "Verify your Swiss identity" : "Verify your estate ownership"}
            </p>
            {!kyc.verificationUrl ? (
              <div className="kyc-scan-loading">
                <div className="spinner" />
                <p className="info" style={{ fontSize: "0.82rem" }}>Generating verification code…</p>
              </div>
            ) : (
              <>
                <p className="info" style={{ fontSize: "0.82rem", lineHeight: 1.7 }}>
                  Open your <strong>SWIYU</strong> or <strong>eID wallet app</strong> and scan the code below.
                </p>
                <div className="kyc-qr-frame">
                  <QRCodeSVG value={kyc.verificationUrl} size={196} bgColor="#faf7f2" fgColor="#1a120a" />
                </div>
                <div className="kyc-scan-status">
                  <div className="spinner spinner--sm" />
                  <span>Waiting for scan…</span>
                </div>
                {scanWarning && (
                  <p className="info" style={{ fontSize: "0.78rem", textAlign: "center" }}>
                    Taking longer than expected? Make sure your SWIYU app is open and try scanning again.
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {/* ── ISSUING ── */}
        {kyc.step === "issuing" && (
          <div className="kyc-status-panel">
            <div className="kyc-status-circle kyc-status-circle--ok">&#9741;</div>
            <p className="kyc-status-title">Verification Confirmed</p>
            <p className="info" style={{ fontSize: "0.85rem", lineHeight: 1.7 }}>
              Anchoring your {kyc.verificationStep === "tax" ? "estate" : "identity"} credential on the XRP Ledger…
            </p>
            <div className="spinner" />
          </div>
        )}

        {/* ── ACCEPTING ── */}
        {kyc.step === "accepting" && (
          <div className="kyc-status-panel">
            <div className="kyc-status-circle kyc-status-circle--sign">&#9998;</div>
            <p className="kyc-status-title">Signature Required</p>
            <p className="info" style={{ fontSize: "0.85rem", lineHeight: 1.7 }}>
              A credential acceptance request has been sent to your{" "}
              <strong>Otsu wallet</strong>. Please approve it to continue.
            </p>
            <div className="spinner" />
          </div>
        )}

        {/* ── ERROR ── */}
        {kyc.step === "error" && (
          <div className="kyc-error-panel">
            <div className="kyc-status-circle kyc-status-circle--error">&#10005;</div>
            <p className="kyc-status-title">Verification Failed</p>
            <p className="error" style={{ fontSize: "0.85rem", lineHeight: 1.6 }}>{kyc.error}</p>
            <button onClick={kyc.retry}>Try Again</button>
          </div>
        )}

      </div>
    </div>
  );
}
