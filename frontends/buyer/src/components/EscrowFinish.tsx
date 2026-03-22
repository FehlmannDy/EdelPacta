import { useState, useEffect } from "react";
import { escrowApi, CreateEscrowResult } from "../api/escrow";
import { nftApi, NFTOffer } from "../api/nft";
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
  const [offers, setOffers] = useState<NFTOffer[]>([]);
  const [offersLoading, setOffersLoading] = useState(true);
  const [offersError, setOffersError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(-1);
  const [finishHash, setFinishHash] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setOffersLoading(true);
    setOffersError(null);
    escrowLog.info("querying sell offers for NFT", { buyerAddress: escrow.buyerAddress, nftId: escrow.nftId });
    nftApi.incomingOffersForNft(escrow.buyerAddress, escrow.nftId)
      .then((list) => {
        escrowLog.info("sell offers received", { count: list.length, offers: list });
        if (!cancelled) setOffers(list);
      })
      .catch((err) => {
        escrowLog.error("failed to fetch sell offers", { err });
        if (!cancelled) setOffersError(err instanceof Error ? err.message : "Failed to fetch sell offers");
      })
      .finally(() => { if (!cancelled) setOffersLoading(false); });
    return () => { cancelled = true; };
  }, [escrow.buyerAddress, escrow.nftId]);

  const handleFinish = async (offer: NFTOffer) => {
    escrowLog.info("attempting finish with offer", { offerId: offer.offerId, sequence: offer.sequence, owner: offer.owner });
    if (offer.sequence == null) {
      escrowLog.error("offer.sequence is null/undefined", { offer });
      addToast("Could not determine offer sequence — refresh and try again.", "error");
      return;
    }
    setLoading(true);
    setStep(0);
    try {
      escrowLog.info("submitting EscrowFinish", { escrow, offerSequence: offer.sequence });
      setStep(1);
      const res = await escrowApi.finish({
        escrowSequence: escrow.escrowSequence,
        nftId: escrow.nftId,
        offerSequence: offer.sequence,
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
          All WASM checks passed. XRP released to the seller. Accept the NFT title deed below.
        </p>
        <button onClick={() => onFinished(finishHash)}>
          Continue to Accept Title Deed →
        </button>
      </section>
    );
  }

  return (
    <section className="form-card">
      <h2>Finalize Escrow</h2>
      <p className="info" style={{ fontSize: "0.85rem", lineHeight: 1.7 }}>
        The notary submits EscrowFinish. The on-chain WASM verifies notary authorization,
        seller KYC, NFT ownership, and dual cryptographic signatures.
      </p>

      <div className="result" style={{ marginBottom: "1rem" }}>
        <p><strong>Escrow Account</strong><br /><Copyable text={escrow.escrowAccount} truncate={10} /></p>
        <p><strong>Escrow Sequence</strong><br />#{escrow.escrowSequence}</p>
        <p><strong>NFT ID</strong><br /><Copyable text={escrow.nftId} truncate={10} /></p>
      </div>

      {offersLoading && (
        <p className="info" style={{ fontSize: "0.82rem" }}>
          <span className="spinner spinner--sm spinner--inline" /> Looking for seller's NFT offer on-chain…
        </p>
      )}

      {!offersLoading && offersError && (
        <p className="error" style={{ fontSize: "0.82rem" }}>{offersError}</p>
      )}

      {!offersLoading && !offersError && offers.length === 0 && (
        <div className="empty-state">
          <span>No active sell offer found for this NFT.</span>
          <span>Ask the seller to create a sell offer targeting your address, then refresh.</span>
          <button
            className="btn-secondary"
            style={{ marginTop: "0.5rem", fontSize: "0.75rem" }}
            onClick={() => {
              setOffersLoading(true);
              nftApi.incomingOffersForNft(escrow.buyerAddress, escrow.nftId)
                .then(setOffers)
                .catch((err) => setOffersError(err instanceof Error ? err.message : "Failed to fetch sell offers"))
                .finally(() => setOffersLoading(false));
            }}
          >
            Refresh Offers
          </button>
        </div>
      )}

      {!offersLoading && offers.map((offer) => (
        <div key={offer.offerId} className="result" style={{ marginBottom: "0.75rem" }}>
          <p><strong>Offer ID</strong><br /><Copyable text={offer.offerId} truncate={10} /></p>
          <p><strong>From (Seller)</strong><br /><Copyable text={offer.owner} truncate={10} /></p>
          {step >= 0 && <Stepper steps={STEPS} current={step} />}
          <button onClick={() => handleFinish(offer)} disabled={loading}>
            {loading ? "Running WASM checks…" : "Finalize & Release XRP"}
          </button>
        </div>
      ))}
    </section>
  );
}
