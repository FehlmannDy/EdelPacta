import { useState } from "react";
import { escrowApi, CreateEscrowResult } from "../api/escrow";
import { escrowLog } from "../logger";
import { Stepper } from "@shared/components/Stepper";
import { Copyable } from "@shared/components/Copyable";
import { useToast } from "@shared/context/ToastContext";

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

  const handleFinish = async () => {
    setLoading(true);
    setStep(0);
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
      addToast("Escrow finalized — XRP released to seller.", "success");
    } catch (err) {
      escrowLog.error("finish failed", { err });
      addToast(err instanceof Error ? err.message : "EscrowFinish failed", "error");
      setStep(-1);
    } finally {
      setLoading(false);
    }
  };

  if (finishHash) {
    return (
      <section className="form-card">
        <h2>Escrow Finalized</h2>
        <div className="result">
          <p><strong>Finish Tx Hash</strong><br /><Copyable text={finishHash} truncate={10} /></p>
        </div>
        <p className="info" style={{ fontSize: "0.82rem", lineHeight: 1.7 }}>
          All WASM checks passed. XRP released to the seller.
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
        The notary submits EscrowFinish. The on-chain WASM verifies notary authorization,
        seller KYC, buyer NFT ownership, and dual cryptographic signatures.
      </p>

      <div className="result" style={{ marginBottom: "1rem" }}>
        <p><strong>Escrow Account</strong><br /><Copyable text={escrow.escrowAccount} truncate={10} /></p>
        <p><strong>Escrow Sequence</strong><br />#{escrow.escrowSequence}</p>
        <p><strong>NFT ID</strong><br /><Copyable text={escrow.nftId} truncate={10} /></p>
        <p><strong>Buyer</strong><br /><Copyable text={escrow.buyerAddress} truncate={10} /></p>
      </div>

      {step >= 0 && <Stepper steps={STEPS} current={step} />}

      <button onClick={handleFinish} disabled={loading}>
        {loading ? "Running WASM checks…" : "Finalize & Release XRP"}
      </button>
    </section>
  );
}
