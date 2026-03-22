import { useEffect, useImperativeHandle, forwardRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { nftApi, PendingOffer } from "../api/nft";
import { nftLog } from "@shared/logger";
import { Copyable } from "@shared/components/Copyable";
import { SkeletonCard } from "@shared/components/SkeletonCard";
import { translateXrplError } from "@shared/utils/xrplErrors";
import { xrplEpochToDate } from "@shared/utils/xrplEpoch";

interface Props { address: string; }
export interface PendingOffersHandle { load: () => void; }

export const PendingOffers = forwardRef<PendingOffersHandle, Props>(function PendingOffers({ address }, ref) {
  const [offers, setOffers] = useState<PendingOffer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qrId, setQrId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      nftLog.info("loading outgoing offers", { address });
      const result = await nftApi.outgoingOffers(address);
      setOffers(result);
    } catch (err) {
      nftLog.error("failed to load outgoing offers", { err });
      setError(translateXrplError(err));
    } finally {
      setLoading(false);
    }
  };

  useImperativeHandle(ref, () => ({ load }));
  useEffect(() => { load(); }, [address]);

  const sellOffers = offers.filter((o) => o.isSellOffer);

  return (
    <section className="form-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>Pending Transfer Offers ({sellOffers.length})</h2>
        <button onClick={load} disabled={loading} style={{ padding: "0.3rem 0.8rem", fontSize: "0.68rem" }}>
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
      {!loading && sellOffers.length === 0 && !error && (
        <div className="empty-state">
          <p>No pending transfer offers.</p>
          <p>Select a deed above and click Transfer to create one.</p>
        </div>
      )}

      {sellOffers.map((offer) => (
        <div key={offer.offerId} className="result">
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
          <button
            onClick={() => setQrId(qrId === offer.offerId ? null : offer.offerId)}
            style={{ alignSelf: "flex-start", padding: "0.3rem 0.8rem", fontSize: "0.68rem", background: "transparent", border: "1px solid #c8bfb2", color: "#6b5a44" }}
          >
            {qrId === offer.offerId ? "Hide QR" : "Show QR"}
          </button>
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
