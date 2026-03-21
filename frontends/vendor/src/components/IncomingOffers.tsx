import { useState, useEffect, forwardRef, useImperativeHandle } from "react";
import { nftApi, IncomingOffer } from "../api/nft";
import { Stepper } from "./Stepper";
import { Copyable } from "./Copyable";
import { useToast } from "../context/ToastContext";
import { translateXrplError } from "../utils/xrplErrors";

interface Props {
  address: string;
  sign: (tx: Record<string, unknown>) => Promise<string>;
  onAccepted?: () => void;
}

export interface IncomingOffersHandle { load: () => void; }

const TX_STEPS = ["Prepare", "Sign", "Submit"];

function SkeletonCard() {
  return (
    <div className="skeleton-card">
      <div className="skeleton skeleton-line skeleton-line--medium" />
      <div className="skeleton skeleton-line skeleton-line--long" />
      <div className="skeleton skeleton-line skeleton-line--short" />
    </div>
  );
}

function dropsToXrp(drops: string): string {
  const n = Number(drops);
  if (isNaN(n)) return drops;
  return n === 0 ? "Free" : `${(n / 1_000_000).toLocaleString()} XRP`;
}

function formatExpiry(expiration: number | null): string | null {
  if (!expiration) return null;
  // XRPL epoch starts 2000-01-01, Unix epoch starts 1970-01-01 (diff = 946684800s)
  const unixTs = (expiration + 946684800) * 1000;
  const d = new Date(unixTs);
  if (d < new Date()) return "Expired";
  return `Expires ${d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;
}

interface AcceptButtonProps {
  offer: IncomingOffer;
  address: string;
  sign: (tx: Record<string, unknown>) => Promise<string>;
  onDone: () => void;
  onAccepted?: () => void;
}

function AcceptButton({ offer, address, sign, onDone, onAccepted }: AcceptButtonProps) {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [txStep, setTxStep] = useState(-1);
  const [txHash, setTxHash] = useState<string | null>(null);

  const handleAccept = async () => {
    setLoading(true);
    setTxStep(0);
    setTxHash(null);
    try {
      const unsignedTx = await nftApi.prepareAcceptOffer({ account: address, offerId: offer.offerId });
      setTxStep(1);
      const txBlob = await sign(unsignedTx);
      setTxStep(2);
      const result = await nftApi.submit(txBlob);
      setTxStep(3);
      setTxHash(result.txHash);
      addToast("Title deed successfully transferred to your wallet.", "success");
      onDone();
      onAccepted?.();
    } catch (err) {
      addToast(translateXrplError(err), "error");
      setTxStep(-1);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      {txStep >= 0 && <Stepper steps={TX_STEPS} current={txStep} />}
      {txHash && (
        <p style={{ fontFamily: "system-ui", fontSize: "0.78rem", color: "#4a7a50", fontWeight: 600 }}>
          Deed received — Tx: <Copyable text={txHash} truncate={8} />
        </p>
      )}
      {!txHash && (
        <button onClick={handleAccept} disabled={loading} className="btn-nft-action">
          {loading ? "Accepting…" : "Accept Deed"}
        </button>
      )}
    </div>
  );
}

export const IncomingOffers = forwardRef<IncomingOffersHandle, Props>(function IncomingOffers({ address, sign, onAccepted }, ref) {
  const [offers, setOffers] = useState<IncomingOffer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await nftApi.incomingOffersForAccount(address);
      setOffers(result);
    } catch (err) {
      setError(translateXrplError(err));
    } finally {
      setLoading(false);
    }
  };

  useImperativeHandle(ref, () => ({ load }));
  useEffect(() => { load(); }, [address]);

  return (
    <section className="form-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>Incoming Deed Offers ({offers.length})</h2>
        <button onClick={load} disabled={loading} className="btn-nft-action">
          {loading ? "…" : "Refresh"}
        </button>
      </div>

      <p className="info" style={{ fontSize: "0.82rem", lineHeight: 1.6 }}>
        Deed transfer offers sent specifically to your wallet by a notary.
        Review and accept to receive ownership on-chain.
      </p>

      {loading && (
        <>
          <SkeletonCard />
          <SkeletonCard />
        </>
      )}
      {!loading && error && <p className="error">{error}</p>}
      {!loading && !error && offers.length === 0 && (
        <div className="empty-state">
          <p>No incoming offers at the moment.</p>
          <p>Once a notary sends a deed transfer to your address, it will appear here.</p>
        </div>
      )}

      {!loading && offers.map((offer) => {
        const expiry = formatExpiry(offer.expiration);
        const isExpired = expiry === "Expired";
        return (
          <div key={offer.offerId} className="result">
            <p><strong>NFToken ID</strong><br /><Copyable text={offer.nftokenId} truncate={10} /></p>
            <p><strong>From</strong><br /><Copyable text={offer.owner} truncate={10} /></p>
            <p><strong>Offer ID</strong><br /><Copyable text={offer.offerId} truncate={10} /></p>
            <p style={{ fontFamily: "system-ui", fontSize: "0.78rem", color: "#8a7a68" }}>
              Price: {dropsToXrp(offer.amount)}
              {expiry && (
                <span style={{ marginLeft: "1rem", color: isExpired ? "#9b2a2a" : "#8a7a68" }}>
                  · {expiry}
                </span>
              )}
            </p>
            {isExpired ? (
              <p className="error" style={{ fontSize: "0.78rem" }}>This offer has expired and can no longer be accepted.</p>
            ) : (
              <AcceptButton offer={offer} address={address} sign={sign} onDone={load} onAccepted={onAccepted} />
            )}
          </div>
        );
      })}
    </section>
  );
});
