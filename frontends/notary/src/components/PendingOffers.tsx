import { useEffect, useImperativeHandle, forwardRef, useState, useCallback, useRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import { nftApi, PendingOffer } from "../api/nft";
import { nftLog } from "@shared/logger";
import { Copyable } from "@shared/components/Copyable";
import { Modal } from "@shared/components/Modal";
import { SkeletonCard } from "@shared/components/SkeletonCard";
import { useToast } from "@shared/context/ToastContext";
import { translateXrplError } from "@shared/utils/xrplErrors";
import { xrplEpochToDate } from "@shared/utils/xrplEpoch";

export interface PendingOffersHandle { load: () => void; }

export const PendingOffers = forwardRef<PendingOffersHandle, object>(function PendingOffers(_props, ref) {
  const { addToast } = useToast();
  const [issuerAddress, setIssuerAddress] = useState<string | null>(null);
  const [offers, setOffers] = useState<PendingOffer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qrId, setQrId] = useState<string | null>(null);
  const [cancelConfirmId, setCancelConfirmId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
  const [removingOffers, setRemovingOffers] = useState<PendingOffer[]>([]);

  const latestLoadRef = useRef(0);
  const offersRef = useRef<PendingOffer[]>([]);
  const cancellingRef = useRef<string | null>(null);

  offersRef.current = offers;
  cancellingRef.current = cancellingId;

  useEffect(() => {
    fetch("/api/kyc/issuer")
      .then((r) => r.json() as Promise<{ issuer: string }>)
      .then((d) => setIssuerAddress(d.issuer))
      .catch(() => {});
  }, []);

  const load = useCallback(async (silent = false) => {
    if (!issuerAddress) return;
    const requestId = ++latestLoadRef.current;
    if (!silent) { setLoading(true); setError(null); }
    try {
      nftLog.info("loading outgoing offers", { issuerAddress });
      const result = await nftApi.outgoingOffers(issuerAddress);
      if (requestId !== latestLoadRef.current) return;
      if (silent) {
        const prev = offersRef.current;
        const prevIds = new Set(prev.map((o) => o.offerId));
        const nextIds = new Set(result.map((o) => o.offerId));
        const added = result.filter((o) => !prevIds.has(o.offerId));
        const removed = prev.filter((o) => !nextIds.has(o.offerId));
        if (removed.length > 0) {
          setRemovingIds(new Set(removed.map((o) => o.offerId)));
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
          setNewIds(new Set(added.map((o) => o.offerId)));
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
      if (!silent) {
        nftLog.error("failed to load outgoing offers", { err });
        setError(translateXrplError(err));
      }
    } finally {
      if (requestId !== latestLoadRef.current) return;
      if (!silent) setLoading(false);
    }
  }, [issuerAddress]);

  const handleCancel = async (offer: PendingOffer) => {
    setCancelConfirmId(null);
    setCancellingId(offer.offerId);
    try {
      nftLog.info("cancelling offer", { offerId: offer.offerId });
      await nftApi.issuerCancelOffer({ offerIds: [offer.offerId] });
      nftLog.info("burning deed", { nftokenId: offer.nftokenId });
      await nftApi.issuerBurn({ nftokenId: offer.nftokenId });
      addToast("Transfer offer cancelled and deed burned.", "success");
      load(true);
    } catch (err) {
      nftLog.error("cancel/burn failed", { err });
      addToast(translateXrplError(err), "error");
    } finally {
      setCancellingId(null);
    }
  };

  useImperativeHandle(ref, () => ({ load: () => load(true) }), [load]);

  useEffect(() => {
    load(false);
    let id: ReturnType<typeof setInterval>;
    const jitter = setTimeout(() => {
      id = setInterval(() => { if (!cancellingRef.current) load(true); }, 15_000);
    }, Math.random() * 5_000);
    return () => { clearTimeout(jitter); clearInterval(id); };
  }, [load]);

  const displayOffers = [
    ...offers,
    ...removingOffers.filter((ro) => !offers.some((o) => o.offerId === ro.offerId)),
  ];
  const displaySellOffers = displayOffers.filter((o) => o.isSellOffer);
  const sellOffersCount = offers.filter((o) => o.isSellOffer).length;

  return (
    <section className="form-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>Pending Transfer Offers ({sellOffersCount})</h2>
        <button onClick={() => load(false)} disabled={loading} style={{ padding: "0.3rem 0.8rem", fontSize: "0.68rem" }}>
          {loading ? "…" : "Refresh"}
        </button>
      </div>

      {loading && (
        <>
          <SkeletonCard />
          <SkeletonCard />
        </>
      )}
      {!loading && error && <p className="error">{error}</p>}
      {!loading && displaySellOffers.length === 0 && !error && (
        <div className="empty-state">
          <p>No pending transfer offers.</p>
          <p>Select a deed above and click Transfer to create one.</p>
        </div>
      )}

      {displaySellOffers.map((offer) => (
        <div
          key={offer.offerId}
          className={[
            "result",
            newIds.has(offer.offerId) ? "result--new" : "",
            removingIds.has(offer.offerId) ? "result--removing" : "",
          ].filter(Boolean).join(" ")}
        >
          <Modal
            open={cancelConfirmId === offer.offerId}
            title="Cancel Offer & Burn Deed"
            danger
            message="Cancel this transfer offer and permanently burn the deed? This cannot be undone."
            confirmLabel="Cancel & Burn"
            onConfirm={() => handleCancel(offer)}
            onCancel={() => setCancelConfirmId(null)}
          />
          <p>
            <strong>Offer ID</strong><br />
            <Copyable text={offer.offerId} truncate={10} />
          </p>
          <p style={{ fontSize: "0.75rem" }}>
            <strong>NFT</strong>&nbsp;<Copyable text={offer.nftokenId} truncate={10} />
          </p>
          {offer.destination && (
            <p style={{ fontSize: "0.75rem" }}>
              <strong>Recipient</strong>&nbsp;<Copyable text={offer.destination} truncate={10} />
            </p>
          )}
          {offer.expiration && (
            <p style={{ fontSize: "0.72rem", color: "#8a7a68", fontFamily: "system-ui" }}>
              Expires {xrplEpochToDate(offer.expiration).toLocaleString()}
            </p>
          )}
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button
              onClick={() => setQrId(qrId === offer.offerId ? null : offer.offerId)}
              style={{ alignSelf: "flex-start", padding: "0.3rem 0.8rem", fontSize: "0.68rem", background: "transparent", border: "1px solid #c8bfb2", color: "#6b5a44" }}
            >
              {qrId === offer.offerId ? "Hide QR" : "Show QR"}
            </button>
            <button
              onClick={() => setCancelConfirmId(offer.offerId)}
              disabled={cancellingId !== null}
              style={{ alignSelf: "flex-start", padding: "0.3rem 0.8rem", fontSize: "0.68rem", background: "transparent", border: "1px solid #9b2a2a", color: "#9b2a2a" }}
            >
              {cancellingId === offer.offerId ? "…" : "Cancel Offer"}
            </button>
          </div>
          {qrId === offer.offerId && (
            <div style={{ display: "flex", justifyContent: "center", padding: "0.75rem 0" }}>
              <QRCodeSVG value={offer.offerId} size={160} bgColor="#ede8dc" fgColor="#1a120a" />
            </div>
          )}
        </div>
      ))}
    </section>
  );
});
