import { useState, useEffect } from "react";
import { nftApi, IncomingOffer } from "../api/nft";
import { Stepper } from "@shared/components/Stepper";
import { Copyable } from "@shared/components/Copyable";
import { SkeletonCard } from "@shared/components/SkeletonCard";
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
  const [offers, setOffers] = useState<IncomingOffer[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [txStep, setTxStep] = useState(-1);

  const load = async () => {
    setLoading(true);
    try {
      const result = await nftApi.incomingOffersForAccount(address);
      setOffers(result);
    } catch (_) {
      // silent
    } finally {
      setLoading(false);
      setInitialLoad(false);
    }
  };

  useEffect(() => { load(); }, [address]);

  const handleAccept = async (offer: IncomingOffer) => {
    setAcceptingId(offer.offerId);
    setTxStep(0);
    try {
      const unsignedTx = await nftApi.prepareAcceptOffer({ account: address, offerId: offer.offerId });
      setTxStep(1);
      const txBlob = await sign(unsignedTx);
      setTxStep(2);
      await nftApi.submit(txBlob);
      setTxStep(3);
      addToast("Title deed successfully transferred to your wallet.", "success");
      onAccepted?.();
      load();
    } catch (err) {
      addToast(translateXrplError(err), "error");
      setTxStep(-1);
    } finally {
      setAcceptingId(null);
    }
  };

  return (
    <section className="form-card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2>Incoming Deed Offers</h2>
        <button onClick={load} disabled={loading} className="btn-nft-action">
          {loading ? "…" : "Refresh"}
        </button>
      </div>

      {loading && initialLoad ? (
        <>
          <SkeletonCard />
          <SkeletonCard />
        </>
      ) : offers.length === 0 ? (
        <div className="empty-state">
          <p>No incoming deed offers.</p>
          <p>An offer will appear here once the notary sends you a title deed.</p>
        </div>
      ) : (
        offers.map((offer) => {
          const isAccepting = acceptingId === offer.offerId;
          return (
            <div key={offer.offerId} className="result">
              <p><strong>NFT ID</strong><br /><Copyable text={offer.nftokenId} truncate={12} /></p>
              <p><strong>From</strong><br /><Copyable text={offer.owner} truncate={12} /></p>
              <p><strong>Offer ID</strong><br /><Copyable text={offer.offerId} truncate={12} /></p>
              {isAccepting && txStep >= 0 && <Stepper steps={TX_STEPS} current={txStep} />}
              <button
                className="btn-nft-action"
                onClick={() => handleAccept(offer)}
                disabled={acceptingId !== null}
              >
                {isAccepting ? "…" : "Accept Deed →"}
              </button>
            </div>
          );
        })
      )}
    </section>
  );
}
