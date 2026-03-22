import { useState, useEffect } from "react";
import { nftApi, IncomingOffer, NFTOffer } from "../api/nft";
import { escrowLog } from "../logger";
import { Stepper } from "@shared/components/Stepper";
import { Copyable } from "@shared/components/Copyable";
import { SkeletonCard } from "@shared/components/SkeletonCard";
import { useToast } from "@shared/context/ToastContext";

interface Props {
  buyerAddress: string;
  nftId?: string;
  sign: (tx: Record<string, unknown>) => Promise<string>;
  onAccepted: () => void;
}

const STEPS = ["Prepare", "Sign", "Submit"];

function AcceptButton({
  offer, buyerAddress, sign, onDone, onAccepted,
}: {
  offer: IncomingOffer | NFTOffer;
  buyerAddress: string;
  sign: (tx: Record<string, unknown>) => Promise<string>;
  onDone: () => void;
  onAccepted: () => void;
}) {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(-1);
  const [txHash, setTxHash] = useState<string | null>(null);

  const handleAccept = async () => {
    setLoading(true);
    setStep(0);
    try {
      escrowLog.info("preparing NFT accept offer", { offerId: offer.offerId, buyerAddress });
      const tx = await nftApi.prepareAcceptOffer({ account: buyerAddress, offerId: offer.offerId });
      setStep(1);
      const txBlob = await sign(tx);
      setStep(2);
      const res = await nftApi.submit(txBlob);
      escrowLog.info("NFT accepted", res);
      setTxHash(res.txHash);
      addToast("Property title deed transferred to your wallet.", "success");
      onDone();
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
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      {step >= 0 && <Stepper steps={STEPS} current={step} />}
      {txHash && (
        <p style={{ fontFamily: "system-ui", fontSize: "0.78rem", color: "#4a7a50", fontWeight: 600 }}>
          ✓ Deed received — Tx: <Copyable text={txHash} truncate={8} />
        </p>
      )}
      {!txHash && (
        <button onClick={handleAccept} disabled={loading}>
          {loading ? "Accepting title deed…" : "Receive Property Title"}
        </button>
      )}
    </div>
  );
}

export function AcceptNft({ buyerAddress, nftId, sign, onAccepted }: Props) {
  const [offers, setOffers] = useState<Array<IncomingOffer | NFTOffer>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    const fetch: Promise<Array<IncomingOffer | NFTOffer>> = nftId
      ? nftApi.incomingOffersForNft(buyerAddress, nftId)
      : nftApi.incomingOffersForAccount(buyerAddress);
    fetch
      .then(setOffers)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to fetch offers"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [buyerAddress, nftId]);

  return (
    <section className="form-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>Accept Property Title</h2>
        <button onClick={load} disabled={loading} className="btn-secondary"
          style={{ fontSize: "0.65rem", padding: "0.25rem 0.6rem" }}>
          {loading ? "…" : "Refresh"}
        </button>
      </div>
      <p className="info" style={{ fontSize: "0.85rem", lineHeight: 1.7 }}>
        The escrow has been finalized. Accept the seller's NFT offer below to receive
        the property title deed in your wallet.
      </p>

      {loading && <><SkeletonCard /><SkeletonCard /></>}
      {!loading && error && <p className="error">{error}</p>}
      {!loading && !error && offers.length === 0 && (
        <div className="empty-state">
          <span>No incoming deed offers at the moment.</span>
          <span>The seller must create a sell offer targeting your address.</span>
        </div>
      )}

      {!loading && offers.map((offer) => (
        <div key={offer.offerId} className="result">
          <p><strong>NFToken ID</strong><br /><Copyable text={offer.nftokenId} truncate={10} /></p>
          <p><strong>From</strong><br /><Copyable text={offer.owner} truncate={10} /></p>
          <p><strong>Offer ID</strong><br /><Copyable text={offer.offerId} truncate={10} /></p>
          <AcceptButton
            offer={offer}
            buyerAddress={buyerAddress}
            sign={sign}
            onDone={load}
            onAccepted={onAccepted}
          />
        </div>
      ))}
    </section>
  );
}
