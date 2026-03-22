import { useState } from "react";
import { escrowApi, CreateEscrowResult } from "../api/escrow";
import { escrowLog } from "../logger";
import { Stepper } from "./Stepper";
import { Copyable } from "./Copyable";
import { useToast } from "../context/ToastContext";

interface Props {
  escrow: CreateEscrowResult & { nftId: string };
  onFinished: (finishHash: string) => void;
}

const STEPS = ["Verify KYC", "Check Signatures", "Release Funds"];

export function EscrowFinish({ escrow, onFinished }: Props) {
  const { addToast } = useToast();
  const [offerSequence, setOfferSequence] = useState("");
  const [offerSeqError, setOfferSeqError] = useState("");
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(-1);
  const [finishHash, setFinishHash] = useState<string | null>(null);

  function validate() {
    const n = parseInt(offerSequence, 10);
    if (isNaN(n) || n < 0) {
      setOfferSeqError("Must be a valid positive integer");
      return false;
    }
    setOfferSeqError("");
    return true;
  }

  const handleFinish = async () => {
    if (!validate()) return;
    setLoading(true);
    setStep(0);
    try {
      escrowLog.info("submitting EscrowFinish", { escrow, offerSequence });
      setStep(1);
      const res = await escrowApi.finish({
        buyerAddress: escrow.buyerAddress,
        escrowSequence: escrow.escrowSequence,
        nftId: escrow.nftId,
        offerSequence: parseInt(offerSequence, 10),
      });
      setStep(2);
      escrowLog.info("escrow finished", res);
      setFinishHash(res.hash);
      onFinished(res.hash);
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
          All 6 WASM checks passed. XRP released to the seller. Accept the NFT title deed below.
        </p>
      </section>
    );
  }

  return (
    <section className="form-card">
      <h2>Finalize Escrow</h2>
      <p className="info" style={{ fontSize: "0.85rem", lineHeight: 1.7 }}>
        The notary submits EscrowFinish with 6 memos. The on-chain WASM verifies:
        notary authorization, seller KYC, NFT ownership, dual cryptographic signatures,
        and active NFT sell offer.
      </p>

      <div className="result" style={{ marginBottom: 0 }}>
        <p><strong>Buyer</strong><br /><Copyable text={escrow.buyerAddress} truncate={10} /></p>
        <p><strong>Escrow Sequence</strong><br />{escrow.escrowSequence}</p>
        <p><strong>NFT ID</strong><br /><Copyable text={escrow.nftId} truncate={10} /></p>
      </div>

      <label>
        NFT Offer Sequence
        <input
          type="number"
          placeholder="Sequence number of the seller's NFTokenCreateOffer tx"
          min="0"
          step="1"
          value={offerSequence}
          onChange={(e) => setOfferSequence(e.target.value)}
          disabled={loading}
        />
        {offerSeqError && <span className="field-error">{offerSeqError}</span>}
      </label>

      {step >= 0 && <Stepper steps={STEPS} current={step} />}

      <button onClick={handleFinish} disabled={loading || !offerSequence}>
        {loading ? "Running WASM checks…" : "Finalize & Release XRP"}
      </button>
    </section>
  );
}
