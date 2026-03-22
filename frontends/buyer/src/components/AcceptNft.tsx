import { useState } from "react";
import { nftApi } from "../api/nft";
import { escrowLog } from "../logger";
import { Stepper } from "./Stepper";
import { Copyable } from "./Copyable";
import { useToast } from "../context/ToastContext";

interface Props {
  buyerAddress: string;
  sign: (tx: Record<string, unknown>) => Promise<string>;
  onAccepted: () => void;
}

const STEPS = ["Prepare", "Sign", "Submit"];

export function AcceptNft({ buyerAddress, sign, onAccepted }: Props) {
  const { addToast } = useToast();
  const [offerId, setOfferId] = useState("");
  const [offerError, setOfferError] = useState("");
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(-1);
  const [txHash, setTxHash] = useState<string | null>(null);

  function validate() {
    if (!offerId.trim() || !/^[0-9A-Fa-f]{64}$/.test(offerId.trim())) {
      setOfferError("Offer ID must be a 64-character hex string");
      return false;
    }
    setOfferError("");
    return true;
  }

  const handleAccept = async () => {
    if (!validate()) return;
    setLoading(true);
    setStep(0);
    setTxHash(null);
    try {
      escrowLog.info("preparing NFT accept offer", { offerId, buyerAddress });
      const tx = await nftApi.prepareAcceptOffer({ account: buyerAddress, offerId: offerId.trim() });
      setStep(1);
      escrowLog.info("signing with Otsu wallet");
      const txBlob = await sign(tx);
      setStep(2);
      escrowLog.info("submitting NFT accept offer");
      const res = await nftApi.submit(txBlob);
      escrowLog.info("NFT accepted", res);
      setTxHash(res.txHash);
      addToast("Property title deed transferred to your wallet.", "success");
      onAccepted();
    } catch (err) {
      escrowLog.error("accept NFT failed", { err });
      addToast(err instanceof Error ? err.message : "NFT acceptance failed", "error");
      setStep(-1);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="form-card">
      <h2>Accept Property Title</h2>
      <p className="info" style={{ fontSize: "0.85rem", lineHeight: 1.7 }}>
        The escrow has been finalized. Accept the seller's NFT offer to receive
        the property title deed in your wallet.
      </p>

      <label>
        NFT Sell Offer ID
        <input
          type="text"
          placeholder="64-character hex — offer index from the seller"
          value={offerId}
          onChange={(e) => { setOfferId(e.target.value); setOfferError(""); }}
          disabled={loading}
        />
        {offerError && <span className="field-error">{offerError}</span>}
      </label>

      {step >= 0 && <Stepper steps={STEPS} current={step} />}

      <button onClick={handleAccept} disabled={loading || !offerId.trim()}>
        {loading ? "Accepting title deed…" : "Receive Property Title"}
      </button>

      {txHash && (
        <div className="result">
          <p style={{ color: "#4a7a50", fontFamily: "system-ui", fontSize: "0.85rem", fontWeight: 600 }}>
            ✓ Property title deed is now in your wallet.
          </p>
          <p><strong>Tx Hash</strong><br /><Copyable text={txHash} truncate={10} /></p>
        </div>
      )}
    </section>
  );
}
