import { Copyable } from "@shared/components/Copyable";
import { Stepper } from "@shared/components/Stepper";
import { useToast } from "@shared/context/ToastContext";
import { escrowLog } from "@shared/logger";
import { useCallback, useEffect, useState } from "react";
import { CreateEscrowResult, escrowApi } from "../api/escrow";

interface Props {
  escrow: CreateEscrowResult & { nftId: string };
  onFinished: (finishHash: string) => void;
}

const STEPS = ["Verify KYC", "Check Signatures", "Release Funds"];

export function EscrowFinish({ escrow, onFinished }: Props) {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(-1);
  const [finishHash, setFinishHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFinish = useCallback(async () => {
    if (loading || finishHash) return;
    setLoading(true);
    setStep(0);
    setError(null);
    try {
      escrowLog.info("submitting EscrowFinish", { escrow });
      setStep(1);
      const res = await escrowApi.finish({
        escrowSequence: escrow.escrowSequence,
        nftId: escrow.nftId,
        buyerAddress: escrow.buyerAddress,
      });
      setStep(2);
      escrowLog.info("escrow finished", res);
      setFinishHash(res.hash);
      addToast("Escrow finalized — XRP released to vendor.", "success");
    } catch (err) {
      escrowLog.error("finish failed", { err });
      const message = err instanceof Error ? err.message : "EscrowFinish failed";
      addToast(message, "error");
      setError(message);
      setStep(-1);
    } finally {
      setLoading(false);
    }
  }, [addToast, escrow, finishHash, loading]);

  useEffect(() => {
    void handleFinish();
  }, [handleFinish]);

  if (finishHash) {
    return (
      <section className="form-card">
        <h2>Escrow Finalized</h2>
        <div className="result">
          <p><strong>Finish Tx Hash</strong><br /><Copyable text={finishHash} truncate={10} /></p>
        </div>
        <p className="info" style={{ fontSize: "0.82rem", lineHeight: 1.7 }}>
          All WASM checks passed. XRP released to the vendor.
        </p>
        <button onClick={() => onFinished(finishHash)}>
          Continue →
        </button>
      </section>
    );
  }

  return (
    <section className="form-card">
      <h2>Finalize Escrow</h2>
      <p className="info" style={{ fontSize: "0.85rem", lineHeight: 1.7 }}>
        The notary submits EscrowFinish automatically. The on-chain WASM verifies notary
        authorization, vendor KYC, buyer NFT ownership, and dual cryptographic signatures.
      </p>

      <div className="result" style={{ marginBottom: "1rem" }}>
        <p><strong>Escrow Account</strong><br /><Copyable text={escrow.escrowAccount} truncate={10} /></p>
        <p><strong>Escrow Sequence</strong><br />#{escrow.escrowSequence}</p>
        <p><strong>NFT ID</strong><br /><Copyable text={escrow.nftId} truncate={10} /></p>
        <p><strong>Buyer</strong><br /><Copyable text={escrow.buyerAddress} truncate={10} /></p>
      </div>

      {step >= 0 && <Stepper steps={STEPS} current={step} />}
      {loading && (
        <p className="info" style={{ fontSize: "0.82rem", marginTop: "0.75rem" }}>
          Running WASM checks and waiting for validated ledger state…
        </p>
      )}
      {!loading && error && (
        <>
          <p className="error" style={{ marginTop: "0.75rem" }}>{error}</p>
          <button onClick={() => void handleFinish()}>
            Retry Finalization
          </button>
        </>
      )}
    </section>
  );
}
