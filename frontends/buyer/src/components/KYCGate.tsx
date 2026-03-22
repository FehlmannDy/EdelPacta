import { QRCodeSVG } from "qrcode.react";
import { useKYC, KYCStep } from "../hooks/useKYC";
import { nftApi } from "../api/nft";
import { useEffect, useState } from "react";

interface Props {
  address: string;
  sign: (tx: Record<string, unknown>) => Promise<string>;
  children: React.ReactNode;
  onStep?: (step: KYCStep) => void;
}

function getProgress(step: KYCStep): number {
  if (step === "scanning")  return 40;
  if (step === "issuing")   return 70;
  if (step === "accepting") return 85;
  return 10;
}

export function KYCGate({ address, sign, children, onStep }: Props) {
  const submit = (txBlob: string) => nftApi.submit(txBlob);
  const kyc = useKYC(address, sign, submit);
  const [starting, setStarting] = useState(false);

  useEffect(() => { onStep?.(kyc.step); }, [kyc.step]);

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

  const progress = getProgress(kyc.step);

  return (
    <div className="kyc-overlay">
      <div className="form-card kyc-card">

        {/* Header */}
        <div className="kyc-card-header">
          <h2>Identity Verification</h2>
          <p className="kyc-tagline">One-time check required to use EdelPacta</p>
        </div>

        {/* Progress bar */}
        {kyc.step !== "error" && (
          <div className="progress-bar-wrap">
            <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
          </div>
        )}

        {/* ── START ── */}
        {kyc.step === "start" && (
          <div className="kyc-start">
            <p className="info" style={{ fontSize: "0.88rem", lineHeight: 1.75 }}>
              Before purchasing property, we need to verify your identity using your Swiss digital credentials.
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
            <p className="kyc-scan-subtitle">Verify your Swiss identity</p>
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
                  <span>{kyc.streamState ?? "Waiting for scan…"}</span>
                </div>
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
              Anchoring your identity credential on the XRP Ledger…
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
