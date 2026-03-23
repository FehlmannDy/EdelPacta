import { Copyable } from "@shared/components/Copyable";
import { Modal } from "@shared/components/Modal";
import { SkeletonCard } from "@shared/components/SkeletonCard";
import { Stepper } from "@shared/components/Stepper";
import { useToast } from "@shared/context/ToastContext";
import { translateXrplError } from "@shared/utils/xrplErrors";
import { useCallback, useEffect, useRef, useState } from "react";
import { IncomingOffer, nftApi, submitTx } from "../api/nft";
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
  const [error, setError] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [acceptDisplayId, setAcceptDisplayId] = useState<string | null>(null);
  const [txStep, setTxStep] = useState(-1);
  const [txError, setTxError] = useState(false);
  const latestLoadRef = useRef(0);
  const acceptingRef = useRef<string | null>(null);
  acceptingRef.current = acceptingId;
  const offersRef = useRef<IncomingOffer[]>([]);
  offersRef.current = offers;

  const [pendingOffer, setPendingOffer] = useState<IncomingOffer | null>(null);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
  const [removingOffers, setRemovingOffers] = useState<IncomingOffer[]>([]);

  const load = useCallback(async (silent = false) => {
    const requestId = ++latestLoadRef.current;
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const result = await nftApi.incomingOffersForAccount(address);
      if (requestId !== latestLoadRef.current) return;
      if (silent) {
        const prev = offersRef.current;
        const prevIds = new Set(prev.map(o => o.offerId));
        const nextIds = new Set(result.map(o => o.offerId));
        const added = result.filter(o => !prevIds.has(o.offerId));
        const removed = prev.filter(o => !nextIds.has(o.offerId));
        if (removed.length > 0) {
          setRemovingIds(new Set(removed.map(o => o.offerId)));
          setRemovingOffers(removed);
          setTimeout(() => {
            if (requestId !== latestLoadRef.current) return;
            setOffers(result);
            setRemovingIds(new Set());
            setRemovingOffers([]);
          }, 350);
        } else {
          setOffers(result);
        }
        if (added.length > 0) {
          setNewIds(new Set(added.map(o => o.offerId)));
          setTimeout(() => setNewIds(new Set()), 2500);
        }
      } else {
        setOffers(result);
        setNewIds(new Set());
        setRemovingIds(new Set());
        setRemovingOffers([]);
      }
    } catch (err) {
      if (requestId !== latestLoadRef.current) return;
      if (!silent) setError(translateXrplError(err));
    } finally {
      if (requestId !== latestLoadRef.current) return;
      if (!silent) setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    load(false);
    let id: ReturnType<typeof setInterval>;
    const jitter = setTimeout(() => {
      id = setInterval(() => {
        if (acceptingRef.current === null) load(true);
      }, 15_000);
    }, Math.random() * 5_000);
    return () => { clearTimeout(jitter); clearInterval(id); };
  }, [load]);

  const handleAccept = async (offer: IncomingOffer) => {
    if (acceptingId !== null) return;
    setAcceptingId(offer.offerId);
    setAcceptDisplayId(offer.offerId);
    setTxStep(0);
    setTxError(false);
    try {
      const unsignedTx = await nftApi.prepareAcceptOffer({ account: address, offerId: offer.offerId });
      setTxStep(1);
      const txBlob = await sign(unsignedTx);
      setTxStep(2);
      await submitTx(txBlob);
      setTxStep(3);
      addToast("Title deed successfully transferred to your wallet.", "success");
      onAccepted?.();
      await load(true);
      setAcceptDisplayId(null);
      setTxStep(-1);
    } catch (err) {
      addToast(translateXrplError(err), "error");
      setTxError(true);
    } finally {
      setAcceptingId(null);
    }
  };

  const actionInProgress = acceptingId !== null;
  const displayOffers = [
    ...offers,
    ...removingOffers.filter(ro => !offers.some(o => o.offerId === ro.offerId)),
  ];

  return (
    <section className="form-card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2>Incoming Deed Offers ({offers.length})</h2>
        <button onClick={() => load(false)} disabled={loading || actionInProgress} className="btn-nft-action">
          {loading ? "…" : "Refresh"}
        </button>
      </div>

      {loading && (
        <>
          <SkeletonCard />
          <SkeletonCard />
        </>
      )}
      {!loading && (
        error ? (
          <p className="error">{error}</p>
        ) : displayOffers.length === 0 ? (
          <div className="empty-state">
            <p>No incoming deed offers.</p>
            <p>An offer will appear here once the notary sends you a title deed.</p>
          </div>
        ) : (
          displayOffers.map((offer) => {
            const isNew = newIds.has(offer.offerId);
            const isRemoving = removingIds.has(offer.offerId);
            const isAccepting = acceptingId === offer.offerId;
            const showStepper = acceptDisplayId === offer.offerId && txStep >= 0;
            return (
              <div
                key={offer.offerId}
                className={`result${isNew ? " result--new" : ""}${isRemoving ? " result--removing" : ""}`}
              >
                <p><strong>NFT ID</strong><br /><Copyable text={offer.nftokenId} truncate={12} /></p>
                <p><strong>From</strong><br /><Copyable text={offer.owner} truncate={12} /></p>
                <p><strong>Offer ID</strong><br /><Copyable text={offer.offerId} truncate={12} /></p>
                {showStepper && <Stepper steps={TX_STEPS} current={txStep} error={txError} />}
                <button
                  className="btn-nft-action"
                  onClick={() => setPendingOffer(offer)}
                  disabled={actionInProgress || loading}
                >
                  {isAccepting ? "…" : acceptDisplayId === offer.offerId && txError ? "Retry Accept Deed →" : "Accept Deed →"}
                </button>
              </div>
            );
          })
        )
      )}
      <Modal
        open={pendingOffer !== null}
        title="Accept deed offer"
        message="Accept this deed offer? The title deed will be transferred to your wallet once confirmed on the blockchain."
        confirmLabel="Accept Deed"
        onConfirm={() => {
          if (pendingOffer) handleAccept(pendingOffer);
          setPendingOffer(null);
        }}
        onCancel={() => setPendingOffer(null)}
      />
    </section>
  );
}
