import { useState } from "react";
import { nftApi } from "../api/nft";
import { nftLog } from "../logger";
import { Stepper } from "./Stepper";
import { Copyable } from "./Copyable";
import { useToast } from "../context/ToastContext";
import { translateXrplError } from "../utils/xrplErrors";

interface Props {
  address: string;
  sign: (tx: Record<string, unknown>) => Promise<string>;
  onAccepted?: () => void;
}

const TX_STEPS = ["Prepare", "Sign", "Submit"];

export function Vendor({ address, sign, onAccepted }: Props) {
  const { addToast } = useToast();
  const [offerId, setOfferId] = useState("");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [txStep, setTxStep] = useState(-1);
  const [offerError, setOfferError] = useState("");

  const validateOfferId = (val: string) => {
    if (!val.trim()) return "Offer ID is required.";
    if (!/^[0-9A-Fa-f]{64}$/.test(val.trim())) return "Offer ID must be a 64-character hex string.";
    return "";
  };

  const handleAccept = async () => {
    const err = validateOfferId(offerId);
    if (err) { setOfferError(err); return; }

    setLoading(true);
    setTxHash(null);
    setTxStep(0);
    try {
      nftLog.info("preparing accept offer tx", { offerId: offerId.trim() });
      const unsignedTx = await nftApi.prepareAcceptOffer({ account: address, offerId: offerId.trim() });
      setTxStep(1);
      const txBlob = await sign(unsignedTx);
      setTxStep(2);
      nftLog.info("submitting accept offer tx");
      const result = await nftApi.submit(txBlob);
      nftLog.info("offer accepted", { txHash: result.txHash });
      setTxStep(3);
      setTxHash(result.txHash);
      setOfferId("");
      addToast("Title deed successfully transferred to your wallet.", "success");
      onAccepted?.();
    } catch (err) {
      nftLog.error("accept offer failed", { err });
      addToast(translateXrplError(err), "error");
      setTxStep(-1);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="form-card">
      <h2>Accept Property Title Transfer</h2>
      <p className="info" style={{ fontSize: "0.85rem", lineHeight: 1.7 }}>
        Once your notary has initiated the transfer, paste the Offer ID below
        to finalise the on-chain handover of the title deed to your wallet.
      </p>
      <label>
        Offer ID
        <input
          type="text"
          placeholder="64-character hex string provided by your notary…"
          value={offerId}
          onChange={(e) => { setOfferId(e.target.value); setOfferError(validateOfferId(e.target.value)); }}
        />
        {offerError && <span className="field-error">{offerError}</span>}
      </label>

      {txStep >= 0 && <Stepper steps={TX_STEPS} current={txStep} />}

      <button onClick={handleAccept} disabled={loading || !offerId.trim()}>
        {loading ? "Finalising transfer…" : "Confirm & Accept Deed"}
      </button>

      {txHash && (
        <div className="result">
          <p style={{ color: "#4a7a50", fontFamily: "system-ui", fontSize: "0.85rem", fontWeight: 600 }}>
            ✓ Title deed successfully transferred to your wallet.
          </p>
          <p><strong>Tx Hash</strong><br /><Copyable text={txHash} truncate={10} /></p>
        </div>
      )}
    </section>
  );
}
