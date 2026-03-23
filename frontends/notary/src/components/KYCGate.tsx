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

const STEP_LABELS: Record<KYCStep, string> = {
  checking: "Checking status…",
  start: "Ready to verify",
  scanning: "Scan QR code",
  issuing: "Issuing credential",
  accepting: "Sign acceptance",
  done: "Verified",
  error: "Error",
};

const STEP_PROGRESS: Record<KYCStep, number> = {
  checking: 5,
  start: 10,
  scanning: 40,
  issuing: 70,
  accepting: 85,
  done: 100,
  error: 0,
};

const ORDERED_STEPS: KYCStep[] = ["checking", "start", "scanning", "issuing", "accepting", "done"];

export function KYCGate({ address, sign, children, onStep }: Props) {
  const submit = (txBlob: string) => nftApi.submit(txBlob);
  const kyc = useKYC(address, sign, submit);
  const [starting, setStarting] = useState(false);

  useEffect(() => { onStep?.(kyc.step); }, [kyc.step]);

  useEffect(() => {
    if (kyc.step !== "start") setStarting(false);
  }, [kyc.step]);

  if (kyc.step === "done") return <>{children}</>;
  if (kyc.step === "checking") return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: "3rem", gap: "0.75rem" }}>
      <div className="spinner" />
      <span className="info">Checking your credentials…</span>
    </div>
  );

  const progress = STEP_PROGRESS[kyc.step];

  return (
    <div className="kyc-overlay">
      <div className="form-card kyc-card">
        <h2>Identity Verification</h2>

        <div className="progress-bar-wrap">
          <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
        </div>

        <div className="kyc-steps-row">
          {ORDERED_STEPS.filter((s) => s !== "checking" && s !== "done").map((s) => {
            const idx = ORDERED_STEPS.indexOf(s);
            const curIdx = ORDERED_STEPS.indexOf(kyc.step);
            const done = curIdx > idx;
            const active = kyc.step === s;
            return (
              <span key={s} className={`kyc-step-label${done ? " kyc-step-label--done" : active ? " kyc-step-label--active" : ""}`}>
                {done ? "✓ " : ""}{STEP_LABELS[s]}
              </span>
            );
          })}
        </div>

        <p className="info" style={{ fontSize: "0.85rem" }}>
          A one-time KYC check is required to use EdelPacta.
        </p>

        {kyc.step === "start" && (
          <button
            onClick={() => { setStarting(true); kyc.startKYC(); }}
            disabled={starting}
          >
            {starting ? (
              <><span className="spinner spinner--sm spinner--inline" /> Starting…</>
            ) : "Start KYC Verification"}
          </button>
        )}

        {kyc.step === "scanning" && !kyc.verificationUrl && (
          <div className="kyc-scan-loading">
            <div className="spinner" />
            <p className="info" style={{ fontSize: "0.82rem" }}>Generating verification code…</p>
          </div>
        )}

        {kyc.step === "scanning" && kyc.verificationUrl && (
          <>
            <p className="info" style={{ fontSize: "0.85rem" }}>
              Scan the QR code with your <strong>SWIYU</strong> or <strong>eID wallet app</strong>.
            </p>
            <div className="kyc-qr-frame">
              <QRCodeSVG value={kyc.verificationUrl} size={200} bgColor="#ffffff" fgColor="#1a120a" />
            </div>
            <div className="kyc-scan-status">
              <div className="spinner spinner--sm" />
              <span>{kyc.streamState ?? "Waiting for verification…"}</span>
            </div>
          </>
        )}

        {kyc.step === "issuing" && (
          <>
            <p className="info">Identity verified. Issuing credential on XRPL…</p>
            <div className="spinner" />
          </>
        )}

        {kyc.step === "accepting" && (
          <>
            <p className="info">Please sign the credential acceptance in your Otsu wallet.</p>
            <div className="spinner" />
          </>
        )}

        {kyc.step === "error" && (
          <>
            <p className="error">{kyc.error}</p>
            <button onClick={kyc.retry}>Try Again</button>
          </>
        )}
      </div>
    </div>
  );
}
