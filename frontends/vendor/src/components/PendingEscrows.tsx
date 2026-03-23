import { Copyable } from "@shared/components/Copyable";
import { Modal } from "@shared/components/Modal";
import { SkeletonCard } from "@shared/components/SkeletonCard";
import { Stepper } from "@shared/components/Stepper";
import { useToast } from "@shared/context/ToastContext";
import { dropsToXrp, xrplEpochToDate } from "@shared/utils/xrplEpoch";
import { translateXrplError } from "@shared/utils/xrplErrors";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useRef, useState } from "react";
import { escrowApi, EscrowObject } from "../api/escrow";
import { submitTx, nftApi, NFTOffer, OfferDetails } from "../api/nft";
import { TX_STEPS } from "../constants";

function isCancellable(cancelAfter: number | undefined): boolean {
  if (!cancelAfter) return false;
  return new Date() >= xrplEpochToDate(cancelAfter);
}

function escrowOfferKey(nftId?: string | null, buyerAddress?: string | null): string | null {
  if (!nftId || !buyerAddress) return null;
  return `${nftId.toUpperCase()}::${buyerAddress}`;
}

interface Props {
  address: string;
  sign: (tx: Record<string, unknown>) => Promise<string>;
  onDeedUpdate?: () => void;
}

export function PendingEscrows({ address, sign, onDeedUpdate }: Props) {
  const { addToast } = useToast();
  const [escrows, setEscrows] = useState<EscrowObject[]>([]);
  const [offerByEscrowKey, setOfferByEscrowKey] = useState<Record<string, OfferDetails>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latestLoadRef = useRef(0);
  const escrowsRef = useRef<EscrowObject[]>([]);
  escrowsRef.current = escrows;

  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
  const [removingEscrows, setRemovingEscrows] = useState<EscrowObject[]>([]);

  // Transfer Deed state
  const [transferringSeq, setTransferringSeq] = useState<number | null>(null);
  const [transferDisplaySeq, setTransferDisplaySeq] = useState<number | null>(null);
  const [transferTxStep, setTransferTxStep] = useState(-1);
  const [transferTxError, setTransferTxError] = useState(false);

  // Cancel Offer state
  const [confirmCancelOfferSeq, setConfirmCancelOfferSeq] = useState<number | null>(null);
  const [cancellingOfferSeq, setCancellingOfferSeq] = useState<number | null>(null);
  const [cancelOfferDisplaySeq, setCancelOfferDisplaySeq] = useState<number | null>(null);
  const [cancelOfferTxStep, setCancelOfferTxStep] = useState(-1);
  const [cancelOfferTxError, setCancelOfferTxError] = useState(false);

  // Cancel Escrow state
  const [confirmCancelEscrowSeq, setConfirmCancelEscrowSeq] = useState<number | null>(null);
  const [cancellingEscrowSeq, setCancellingEscrowSeq] = useState<number | null>(null);
  const [cancelEscrowDisplaySeq, setCancelEscrowDisplaySeq] = useState<number | null>(null);
  const [cancelEscrowTxStep, setCancelEscrowTxStep] = useState(-1);
  const [cancelEscrowTxError, setCancelEscrowTxError] = useState(false);

  const [showQRSeq, setShowQRSeq] = useState<number | null>(null);

  const anyAction = transferringSeq !== null || cancellingOfferSeq !== null || cancellingEscrowSeq !== null;
  const anyActionRef = useRef(anyAction);
  anyActionRef.current = anyAction;

  const load = useCallback(async (silent = false) => {
    const requestId = ++latestLoadRef.current;
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const [{ escrows: list }, outgoing] = await Promise.all([
        escrowApi.bySeller(address),
        nftApi.outgoingOffers(address),
      ]);

      const escrowKeys = new Set(
        list
          .map((e) => escrowOfferKey(e.NftId, e.BuyerAddress))
          .filter((k): k is string => Boolean(k))
      );
      const relevantOffers = (outgoing as NFTOffer[]).filter(
        (o) => o.isSellOffer && escrowKeys.has(escrowOfferKey(o.nftokenId, o.destination) ?? "")
      );
      const details: Record<string, OfferDetails> = {};
      await Promise.all(
        relevantOffers.map(async (o) => {
          try {
            const d = await nftApi.getOffer(o.offerId);
            const key = escrowOfferKey(o.nftokenId, o.destination);
            if (key) details[key] = d;
          } catch (_) {}
        })
      );

      if (requestId !== latestLoadRef.current) return;

      if (silent) {
        const prev = escrowsRef.current;
        const prevSeqs = new Set(prev.map(e => String(e.Sequence)));
        const nextSeqs = new Set(list.map(e => String(e.Sequence)));
        const added = list.filter(e => !prevSeqs.has(String(e.Sequence)));
        const removed = prev.filter(e => !nextSeqs.has(String(e.Sequence)));

        if (removed.length > 0) {
          setRemovingIds(new Set(removed.map(e => String(e.Sequence))));
          setRemovingEscrows(removed);
          setTimeout(() => {
            if (requestId !== latestLoadRef.current) return;
            setEscrows(list);
            setOfferByEscrowKey(details);
            setRemovingIds(new Set());
            setRemovingEscrows([]);
          }, 350);
        } else {
          setEscrows(list);
          setOfferByEscrowKey(details);
        }

        if (added.length > 0) {
          setNewIds(new Set(added.map(e => String(e.Sequence))));
          setTimeout(() => setNewIds(new Set()), 2500);
        }
      } else {
        setEscrows(list);
        setOfferByEscrowKey(details);
        setNewIds(new Set());
        setRemovingIds(new Set());
        setRemovingEscrows([]);
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
        if (!anyActionRef.current) load(true);
      }, 15_000);
    }, Math.random() * 5_000);
    return () => { clearTimeout(jitter); clearInterval(id); };
  }, [load]);

  const handleTransfer = async (escrow: EscrowObject) => {
    if (!escrow.NftId || !escrow.BuyerAddress) return;
    setTransferringSeq(escrow.Sequence);
    setTransferDisplaySeq(escrow.Sequence);
    setTransferTxStep(0);
    setTransferTxError(false);
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
      await submitTx(txBlob);
      setTransferTxStep(3);
      addToast("Sell offer created. Buyer can now accept the deed.", "success");
      onDeedUpdate?.();
      await load(true);
      setTransferDisplaySeq(null);
      setTransferTxStep(-1);
    } catch (err) {
      addToast(translateXrplError(err), "error");
      setTransferTxError(true);
    } finally {
      setTransferringSeq(null);
    }
  };

  const handleCancelOffer = async (escrow: EscrowObject) => {
    const offerKey = escrowOfferKey(escrow.NftId, escrow.BuyerAddress);
    const offer = offerKey ? offerByEscrowKey[offerKey] : undefined;
    if (!offer) return;
    setConfirmCancelOfferSeq(null);
    setCancellingOfferSeq(escrow.Sequence);
    setCancelOfferDisplaySeq(escrow.Sequence);
    setCancelOfferTxStep(0);
    setCancelOfferTxError(false);
    try {
      const unsignedTx = await nftApi.prepareCancelOffer({ account: address, offerIds: [offer.offerId] });
      setCancelOfferTxStep(1);
      const txBlob = await sign(unsignedTx);
      setCancelOfferTxStep(2);
      await submitTx(txBlob);
      setCancelOfferTxStep(3);
      addToast("Sell offer cancelled.", "success");
      onDeedUpdate?.();
      await load(true);
      setCancelOfferDisplaySeq(null);
      setCancelOfferTxStep(-1);
    } catch (err) {
      addToast(translateXrplError(err), "error");
      setCancelOfferTxError(true);
    } finally {
      setCancellingOfferSeq(null);
    }
  };

  const handleCancelEscrow = async (escrow: EscrowObject) => {
    setConfirmCancelEscrowSeq(null);
    setCancellingEscrowSeq(escrow.Sequence);
    setCancelEscrowDisplaySeq(escrow.Sequence);
    setCancelEscrowTxStep(0);
    setCancelEscrowTxError(false);
    try {
      const unsignedTx = await escrowApi.prepareCancel({
        cancellerAddress: address,
        ownerAddress: escrow.Account,
        offerSequence: escrow.Sequence,
      });
      setCancelEscrowTxStep(1);
      const txBlob = await sign(unsignedTx);
      setCancelEscrowTxStep(2);
      await submitTx(txBlob);
      setCancelEscrowTxStep(3);
      addToast("Escrow cancelled. Funds returned to escrow account.", "success");
      await load(true);
      setCancelEscrowDisplaySeq(null);
      setCancelEscrowTxStep(-1);
    } catch (err) {
      addToast(translateXrplError(err), "error");
      setCancelEscrowTxError(true);
    } finally {
      setCancellingEscrowSeq(null);
    }
  };

  const displayEscrows = [
    ...escrows,
    ...removingEscrows.filter(re => !escrows.some(e => e.Sequence === re.Sequence)),
  ];

  return (
    <section className="form-card">
      <div className="row-space-between">
        <h2>Active Smart Escrows ({escrows.length})</h2>
        <button onClick={() => load(false)} disabled={loading} className="btn-nft-action">
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
        ) : displayEscrows.length === 0 ? (
          <div className="empty-state">
            <p>No active escrows on-chain.</p>
            <p>An escrow will appear here once the buyer has locked their XRP.</p>
          </div>
        ) : (
          displayEscrows.map((e) => {
            const escrowKey = escrowOfferKey(e.NftId, e.BuyerAddress);
            const existingOffer = escrowKey ? offerByEscrowKey[escrowKey] : undefined;
            const cancellable = isCancellable(e.CancelAfter);
            const isNew = newIds.has(String(e.Sequence));
            const isRemoving = removingIds.has(String(e.Sequence));
            const isTransferring = transferringSeq === e.Sequence;
            const isCancellingOffer = cancellingOfferSeq === e.Sequence;
            const isCancellingEscrow = cancellingEscrowSeq === e.Sequence;
            const showTransferStepper = transferDisplaySeq === e.Sequence && transferTxStep >= 0;
            const showCancelOfferStepper = cancelOfferDisplaySeq === e.Sequence && cancelOfferTxStep >= 0;
            const showCancelEscrowStepper = cancelEscrowDisplaySeq === e.Sequence && cancelEscrowTxStep >= 0;
            const canTransfer = !!e.NftId && !!e.BuyerAddress && !existingOffer;
            const qrPayload = existingOffer
              ? JSON.stringify({ offerId: existingOffer.offerId, sequence: existingOffer.sequence })
              : null;
            const cancelEscrowTitle = !cancellable && e.CancelAfter
              ? `Available after ${xrplEpochToDate(e.CancelAfter).toLocaleString()}`
              : undefined;

            return (
              <div
                key={e.Sequence}
                className={`result${isNew ? " result--new" : ""}${isRemoving ? " result--removing" : ""}`}
              >
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
                  : <p className="escrow-status-text escrow-status-text--muted">Buyer address not found in escrow memo.</p>
                }
                {e.CancelAfter && (
                  <p className={`escrow-status-text ${cancellable ? "escrow-status-text--ok" : "escrow-status-text--muted"}`}>
                    {cancellable ? "✓ Escrow cancellable now" : `Escrow cancellable after ${xrplEpochToDate(e.CancelAfter).toLocaleString()}`}
                  </p>
                )}

                {existingOffer && (
                  <div className="offer-status-badge">
                    <p className="offer-status-badge__title">
                      ✓ Sell offer sent to buyer
                    </p>
                    <p className="offer-status-badge__id">
                      Offer ID: <Copyable text={existingOffer.offerId} truncate={10} />
                    </p>
                  </div>
                )}

                {showTransferStepper && <Stepper steps={TX_STEPS} current={transferTxStep} error={transferTxError} />}
                {showCancelOfferStepper && <Stepper steps={TX_STEPS} current={cancelOfferTxStep} error={cancelOfferTxError} />}
                {showCancelEscrowStepper && <Stepper steps={TX_STEPS} current={cancelEscrowTxStep} error={cancelEscrowTxError} />}

                <div className="btn-row btn-row--mt">
                  {!existingOffer ? (
                    <button
                      className="btn-nft-action"
                      onClick={() => handleTransfer(e)}
                      disabled={!canTransfer || anyAction}
                      title={!e.NftId ? "NFT ID not found in escrow" : !e.BuyerAddress ? "Buyer address not found in escrow" : ""}
                    >
                      {isTransferring ? "…" : transferDisplaySeq === e.Sequence && transferTxError ? "Retry Transfer Deed" : "Transfer Deed to Buyer"}
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
                        className="btn-nft-action btn-danger-outline"
                        onClick={() => setConfirmCancelOfferSeq(e.Sequence)}
                        disabled={anyAction}
                      >
                        {isCancellingOffer ? "…" : cancelOfferDisplaySeq === e.Sequence && cancelOfferTxError ? "Retry Cancel Offer" : "Cancel Offer"}
                      </button>
                    </>
                  )}
                  <button
                    className="btn-nft-action btn-danger-outline"
                    onClick={() => setConfirmCancelEscrowSeq(e.Sequence)}
                    disabled={!cancellable || anyAction}
                    title={cancelEscrowTitle}
                    style={{ color: cancellable ? "#9b2a2a" : undefined }}
                  >
                    {isCancellingEscrow ? "…" : cancelEscrowDisplaySeq === e.Sequence && cancelEscrowTxError ? "Retry Cancel Escrow" : "Cancel Escrow"}
                  </button>
                </div>

                {showQRSeq === e.Sequence && qrPayload && (
                  <div className="qr-center">
                    <div style={{ textAlign: "center" }}>
                      <QRCodeSVG value={qrPayload} size={160} bgColor="#ede8dc" fgColor="#1a120a" />
                      <p className="qr-caption">
                        Scan to get Offer ID + Sequence
                      </p>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )
      )}
    </section>
  );
}
