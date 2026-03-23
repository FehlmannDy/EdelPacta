import { Copyable } from "@shared/components/Copyable";
import { Modal } from "@shared/components/Modal";
import { SkeletonCard } from "@shared/components/SkeletonCard";
import { Stepper } from "@shared/components/Stepper";
import { useToast } from "@shared/context/ToastContext";
import { dropsToXrp, xrplEpochToDate } from "@shared/utils/xrplEpoch";
import { translateXrplError } from "@shared/utils/xrplErrors";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";
import { escrowApi, EscrowObject } from "../api/escrow";
import { nftApi, NFTOffer, OfferDetails } from "../api/nft";
import { TX_STEPS } from "../constants";

const XRPL_EPOCH_OFFSET = 946684800;

function isCancellable(cancelAfter: number | undefined): boolean {
  if (!cancelAfter) return false;
  return Date.now() / 1000 - XRPL_EPOCH_OFFSET >= cancelAfter;
}

interface Props {
  address: string;
  sign: (tx: Record<string, unknown>) => Promise<string>;
  onDeedUpdate?: () => void;
}

export function PendingEscrows({ address, sign, onDeedUpdate }: Props) {
  const { addToast } = useToast();
  const [escrows, setEscrows] = useState<EscrowObject[]>([]);
  const [offerByNftId, setOfferByNftId] = useState<Record<string, OfferDetails>>({});
  const [loading, setLoading] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Transfer Deed state
  const [transferringSeq, setTransferringSeq] = useState<number | null>(null);
  const [transferTxStep, setTransferTxStep] = useState(-1);

  // Cancel Offer state
  const [confirmCancelOfferSeq, setConfirmCancelOfferSeq] = useState<number | null>(null);
  const [cancellingOfferSeq, setCancellingOfferSeq] = useState<number | null>(null);
  const [cancelOfferTxStep, setCancelOfferTxStep] = useState(-1);

  // Cancel Escrow state
  const [confirmCancelEscrowSeq, setConfirmCancelEscrowSeq] = useState<number | null>(null);
  const [cancellingEscrowSeq, setCancellingEscrowSeq] = useState<number | null>(null);
  const [cancelEscrowTxStep, setCancelEscrowTxStep] = useState(-1);

  const [showQRSeq, setShowQRSeq] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [{ escrows: list }, outgoing] = await Promise.all([
        escrowApi.bySeller(address),
        nftApi.outgoingOffers(address),
      ]);
      setEscrows(list);

      // Build a set of NFT IDs from escrows to match against outgoing offers
      const escrowNftIds = new Set(list.map((e) => e.NftId?.toUpperCase()).filter(Boolean));
      const relevantOffers = (outgoing as NFTOffer[]).filter(
        (o) => o.isSellOffer && escrowNftIds.has(o.nftokenId.toUpperCase())
      );

      // Fetch offer details (including sequence) for each relevant offer
      const details: Record<string, OfferDetails> = {};
      await Promise.all(
        relevantOffers.map(async (o) => {
          try {
            const d = await nftApi.getOffer(o.offerId);
            details[o.nftokenId.toUpperCase()] = d;
          } catch (_) {}
        })
      );
      setOfferByNftId(details);
    } catch (err) {
      setError(translateXrplError(err));
    } finally {
      setLoading(false);
      setInitialLoad(false);
    }
  };

  useEffect(() => { load(); }, [address]);

  const handleTransfer = async (escrow: EscrowObject) => {
    if (!escrow.NftId || !escrow.BuyerAddress) return;
    setTransferringSeq(escrow.Sequence);
    setTransferTxStep(0);
    try {
      const unsignedTx = await nftApi.prepareTransferOffer({
        account: address,
        nftokenId: escrow.NftId,
        destination: escrow.BuyerAddress,
        amount: "0",
      });
      setTransferTxStep(1);
      const txBlob = await sign(unsignedTx);
      setTransferTxStep(2);
      await nftApi.submit(txBlob);
      setTransferTxStep(3);
      addToast("Sell offer created. Buyer can now accept the deed.", "success");
      onDeedUpdate?.();
      load();
    } catch (err) {
      addToast(translateXrplError(err), "error");
      setTransferTxStep(-1);
    } finally {
      setTransferringSeq(null);
    }
  };

  const handleCancelOffer = async (escrow: EscrowObject) => {
    const offer = offerByNftId[escrow.NftId?.toUpperCase() ?? ""];
    if (!offer) return;
    setConfirmCancelOfferSeq(null);
    setCancellingOfferSeq(escrow.Sequence);
    setCancelOfferTxStep(0);
    try {
      const unsignedTx = await nftApi.prepareCancelOffer({ account: address, offerIds: [offer.offerId] });
      setCancelOfferTxStep(1);
      const txBlob = await sign(unsignedTx);
      setCancelOfferTxStep(2);
      await nftApi.submit(txBlob);
      setCancelOfferTxStep(3);
      addToast("Sell offer cancelled.", "success");
      onDeedUpdate?.();
      load();
    } catch (err) {
      addToast(translateXrplError(err), "error");
      setCancelOfferTxStep(-1);
    } finally {
      setCancellingOfferSeq(null);
    }
  };

  const handleCancelEscrow = async (escrow: EscrowObject) => {
    setConfirmCancelEscrowSeq(null);
    setCancellingEscrowSeq(escrow.Sequence);
    setCancelEscrowTxStep(0);
    try {
      const unsignedTx = await escrowApi.prepareCancel({
        cancellerAddress: address,
        ownerAddress: escrow.Account,
        offerSequence: escrow.Sequence,
      });
      setCancelEscrowTxStep(1);
      const txBlob = await sign(unsignedTx);
      setCancelEscrowTxStep(2);
      await nftApi.submit(txBlob);
      setCancelEscrowTxStep(3);
      addToast("Escrow cancelled. Funds returned to escrow account.", "success");
      load();
    } catch (err) {
      addToast(translateXrplError(err), "error");
      setCancelEscrowTxStep(-1);
    } finally {
      setCancellingEscrowSeq(null);
    }
  };

  const anyAction = transferringSeq !== null || cancellingOfferSeq !== null || cancellingEscrowSeq !== null;

  return (
    <section className="form-card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2>Active Smart Escrows</h2>
        <button
          onClick={load}
          disabled={loading}
          className="btn-nft-action"
        >
          {loading ? "…" : "Refresh"}
        </button>
      </div>

      {loading && initialLoad ? (
        <>
          <SkeletonCard />
          <SkeletonCard />
        </>
      ) : escrows.length === 0 ? (
        <div className="empty-state">
          <p>No active escrows on-chain.</p>
          <p>An escrow will appear here once the buyer has locked their XRP.</p>
        </div>
      ) : (
        escrows.map((e) => {
          const nftIdKey = e.NftId?.toUpperCase() ?? "";
          const existingOffer = nftIdKey ? offerByNftId[nftIdKey] : undefined;
          const cancellable = isCancellable(e.CancelAfter);
          const isTransferring = transferringSeq === e.Sequence;
          const isCancellingOffer = cancellingOfferSeq === e.Sequence;
          const isCancellingEscrow = cancellingEscrowSeq === e.Sequence;
          const canTransfer = !!e.NftId && !!e.BuyerAddress && !existingOffer;
          const qrPayload = existingOffer
            ? JSON.stringify({ offerId: existingOffer.offerId, sequence: existingOffer.sequence })
            : null;

          return (
            <div key={e.Sequence} className="result">
              <Modal
                open={confirmCancelOfferSeq === e.Sequence}
                title="Cancel Sell Offer"
                danger
                message="Cancel the sell offer? The buyer will no longer be able to accept the deed transfer."
                confirmLabel="Cancel Offer"
                onConfirm={() => handleCancelOffer(e)}
                onCancel={() => setConfirmCancelOfferSeq(null)}
              />
              <Modal
                open={confirmCancelEscrowSeq === e.Sequence}
                title="Cancel Escrow"
                danger
                message="Cancel this escrow? The locked XRP will be returned to the escrow account. This cannot be undone."
                confirmLabel="Cancel Escrow"
                onConfirm={() => handleCancelEscrow(e)}
                onCancel={() => setConfirmCancelEscrowSeq(null)}
              />

              <p><strong>Amount Locked</strong><br />{dropsToXrp(e.Amount)} — Sequence #{e.Sequence}</p>
              {e.NftId && <p><strong>Deed (NFT ID)</strong><br /><Copyable text={e.NftId} truncate={12} /></p>}
              {e.BuyerAddress
                ? <p><strong>Buyer</strong><br /><Copyable text={e.BuyerAddress} truncate={12} /></p>
                : <p style={{ fontFamily: "system-ui", fontSize: "0.78rem", color: "#8a7a68" }}>Buyer address not found in escrow memo.</p>
              }
              {e.CancelAfter && (
                <p style={{ fontFamily: "system-ui", fontSize: "0.78rem", color: cancellable ? "#4a7a50" : "#8a7a68" }}>
                  {cancellable ? "✓ Escrow cancellable now" : `Escrow cancellable after ${xrplEpochToDate(e.CancelAfter).toLocaleString()}`}
                </p>
              )}

              {/* Existing offer info */}
              {existingOffer && (
                <div style={{ background: "#f5f0e8", borderRadius: "6px", padding: "0.6rem 0.75rem", marginTop: "0.25rem" }}>
                  <p style={{ fontFamily: "system-ui", fontSize: "0.78rem", color: "#4a7a50", fontWeight: 600, margin: 0 }}>
                    ✓ Sell offer sent to buyer
                  </p>
                  <p style={{ fontFamily: "system-ui", fontSize: "0.72rem", color: "#8a7a68", margin: "0.25rem 0 0" }}>
                    Offer ID: <Copyable text={existingOffer.offerId} truncate={10} />
                  </p>
                </div>
              )}

              {/* Stepper for active actions */}
              {isTransferring && transferTxStep >= 0 && <Stepper steps={TX_STEPS} current={transferTxStep} />}
              {isCancellingOffer && cancelOfferTxStep >= 0 && <Stepper steps={TX_STEPS} current={cancelOfferTxStep} />}
              {isCancellingEscrow && cancelEscrowTxStep >= 0 && <Stepper steps={TX_STEPS} current={cancelEscrowTxStep} />}

              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.25rem" }}>
                {!existingOffer ? (
                  <button
                    className="btn-nft-action"
                    onClick={() => handleTransfer(e)}
                    disabled={!canTransfer || anyAction}
                    title={!e.NftId ? "NFT ID not found in escrow" : !e.BuyerAddress ? "Buyer address not found in escrow" : ""}
                  >
                    {isTransferring ? "…" : "Transfer Deed to Buyer"}
                  </button>
                ) : (
                  <>
                    <button
                      className="btn-nft-action"
                      onClick={() => setShowQRSeq(showQRSeq === e.Sequence ? null : e.Sequence)}
                      disabled={anyAction}
                    >
                      {showQRSeq === e.Sequence ? "Hide QR" : "Show QR for Buyer"}
                    </button>
                    <button
                      className="btn-nft-action"
                      onClick={() => setConfirmCancelOfferSeq(e.Sequence)}
                      disabled={anyAction}
                      style={{ background: "transparent", border: "1px solid #9b2a2a", color: "#9b2a2a" }}
                    >
                      {isCancellingOffer ? "…" : "Cancel Offer"}
                    </button>
                  </>
                )}
                <button
                  className="btn-nft-action"
                  onClick={() => setConfirmCancelEscrowSeq(e.Sequence)}
                  disabled={!cancellable || anyAction}
                  style={{ background: "transparent", border: "1px solid #9b2a2a", color: cancellable ? "#9b2a2a" : undefined }}
                >
                  {isCancellingEscrow ? "…" : "Cancel Escrow"}
                </button>
              </div>

              {showQRSeq === e.Sequence && qrPayload && (
                <div style={{ display: "flex", justifyContent: "center", padding: "0.75rem 0" }}>
                  <div style={{ textAlign: "center" }}>
                    <QRCodeSVG value={qrPayload} size={160} bgColor="#ede8dc" fgColor="#1a120a" />
                    <p style={{ fontFamily: "system-ui", fontSize: "0.65rem", color: "#8a7a68", marginTop: "0.4rem" }}>
                      Scan to get Offer ID + Sequence
                    </p>
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}
    </section>
  );
}
