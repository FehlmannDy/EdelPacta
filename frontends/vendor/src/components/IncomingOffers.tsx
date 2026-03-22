import { useState } from "react";
import { nftApi } from "../api/nft";
import { Stepper } from "@shared/components/Stepper";
import { Copyable } from "@shared/components/Copyable";
import { useToast } from "@shared/context/ToastContext";
import { translateXrplError } from "@shared/utils/xrplErrors";
import { TX_STEPS } from "../constants";

interface Props {
  address: string;
  sign: (tx: Record<string, unknown>) => Promise<string>;
  onAccepted?: () => void;
}

export function IncomingOffers({ address, sign, onAccepted }: Props) {
  const { addToast } = useToast();
  const [offerId, setOfferId] = useState("");
  const [offerIdError, setOfferIdError] = useState("");
  const [loading, setLoading] = useState(false);
  const [txStep, setTxStep] = useState(-1);
  const [txHash, setTxHash] = useState<string | null>(null);

  const validate = () => {
    if (!offerId.trim()) {
      setOfferIdError("Offer ID is required.");
      return false;
    }
    setOfferIdError("");
    return true;
  };

  const handleAccept = async () => {
    if (!validate()) return;
    setLoading(true);
    setTxStep(0);
    setTxHash(null);
    try {
      const unsignedTx = await nftApi.prepareAcceptOffer({ account: address, offerId: offerId.trim() });
      setTxStep(1);
      const txBlob = await sign(unsignedTx);
      setTxStep(2);
      const result = await nftApi.submit(txBlob);
      setTxStep(3);
      setTxHash(result.txHash);
      setOfferId("");
      addToast("Title deed successfully transferred to your wallet.", "success");
      onAccepted?.();
    } catch (err) {
      addToast(translateXrplError(err), "error");
      setTxStep(-1);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="form-card">
      <h2>Accept Deed Transfer</h2>
      <p className="info" style={{ fontSize: "0.82rem", lineHeight: 1.6 }}>
        Paste the NFT offer ID provided by the notary to accept the deed transfer.
      </p>

      <label>
        Offer ID
        <input
          type="text"
          placeholder="Paste the notary's NFT offer ID…"
          value={offerId}
          onChange={(e) => { setOfferId(e.target.value); setOfferIdError(""); }}
          disabled={loading}
        />
        {offerIdError && <span className="field-error">{offerIdError}</span>}
      </label>

      {txStep >= 0 && <Stepper steps={TX_STEPS} current={txStep} />}

      {txHash && (
        <p style={{ fontFamily: "system-ui", fontSize: "0.78rem", color: "#4a7a50", fontWeight: 600 }}>
          ✓ Deed received — Tx: <Copyable text={txHash} truncate={8} />
        </p>
      )}

      <button onClick={handleAccept} disabled={loading || !offerId.trim()}>
        {loading ? "Accepting…" : "Accept Deed"}
      </button>
    </section>
  );
}
