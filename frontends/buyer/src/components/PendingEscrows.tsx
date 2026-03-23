import { useCallback, useEffect, useRef, useState } from "react";
import { escrowApi, EscrowObject } from "../api/escrow";
import { nftApi } from "../api/nft";
import { Copyable } from "@shared/components/Copyable";
import { Modal } from "@shared/components/Modal";
import { Stepper } from "@shared/components/Stepper";
import { SkeletonCard } from "@shared/components/SkeletonCard";
import { useToast } from "@shared/context/ToastContext";
import { translateXrplError } from "@shared/utils/xrplErrors";
import { xrplEpochToDate, dropsToXrp } from "@shared/utils/xrplEpoch";

function formatExpiry(cancelAfter: number): string {
  return xrplEpochToDate(cancelAfter).toLocaleString();
}

function hexToUtf8(hex: string): string {
  try {
    return decodeURIComponent(hex.replace(/../g, "%$&"));
  } catch {
    return hex;
  }
}

function utf8ToHex(str: string): string {
  return Array.from(new TextEncoder().encode(str))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

const MEMO_TYPE_NFT_ID = utf8ToHex("NFT_ID");

function getNftId(escrow: EscrowObject): string | null {
  if (!escrow.Memos) return null;
  for (const m of escrow.Memos) {
    if (m.Memo.MemoType?.toUpperCase() === MEMO_TYPE_NFT_ID && m.Memo.MemoData) {
      return m.Memo.MemoData.toUpperCase();
    }
  }
  return null;
}

function isCancellable(cancelAfter: number | undefined): boolean {
  if (!cancelAfter) return true;
  return new Date() >= xrplEpochToDate(cancelAfter);
}

const TX_STEPS = ["Prepare", "Sign", "Submit"];

const escrowKey = (e: EscrowObject) => String(e.Sequence);

interface Props {
  address: string;
  sign: (tx: Record<string, unknown>) => Promise<string>;
  onResume?: (escrow: EscrowObject) => void;
}

export function PendingEscrows({ address, sign, onResume }: Props) {
  const { addToast } = useToast();
  const [escrows, setEscrows] = useState<EscrowObject[]>([]);
  const [loading, setLoading] = useState(false);
  const [cancelConfirmSeq, setCancelConfirmSeq] = useState<number | null>(null);
  const [cancellingSeq, setCancellingSeq] = useState<number | null>(null);
  const [cancelTxStep, setCancelTxStep] = useState(-1);

  const latestLoadRef = useRef(0);
  const escrowsRef = useRef<EscrowObject[]>([]);
  escrowsRef.current = escrows;
  const cancellingRef = useRef(false);
  cancellingRef.current = cancellingSeq !== null;

  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
  const [removingEscrows, setRemovingEscrows] = useState<EscrowObject[]>([]);

  const load = useCallback(async (silent = false) => {
    const requestId = ++latestLoadRef.current;
    if (!silent) { setLoading(true); }
    try {
      const { escrows: list } = await escrowApi.byBuyer(address);
      const result = list as EscrowObject[];
      if (requestId !== latestLoadRef.current) return;
      if (silent) {
        const prev = escrowsRef.current;
        const prevIds = new Set(prev.map(escrowKey));
        const nextIds = new Set(result.map(escrowKey));
        const added = result.filter(e => !prevIds.has(escrowKey(e)));
        const removed = prev.filter(e => !nextIds.has(escrowKey(e)));
        if (removed.length > 0) {
          setRemovingIds(new Set(removed.map(escrowKey)));
          setRemovingEscrows(removed);
          setTimeout(() => {
            if (requestId !== latestLoadRef.current) return;
            setEscrows(result);
            setRemovingIds(new Set());
            setRemovingEscrows([]);
          }, 350);
        } else {
          setEscrows(result);
        }
        if (added.length > 0) {
          setNewIds(new Set(added.map(escrowKey)));
          setTimeout(() => setNewIds(new Set()), 2500);
        }
      } else {
        setEscrows(result);
        setNewIds(new Set());
        setRemovingIds(new Set());
        setRemovingEscrows([]);
      }
    } catch (_) {
      if (requestId !== latestLoadRef.current) return;
    } finally {
      if (requestId !== latestLoadRef.current) return;
      if (!silent) setLoading(false);
    }
  }, [address]);

  const handleCancel = async (escrow: EscrowObject) => {
    // BUYER-010: re-validate at call time — the render-time check may be stale
    if (!isCancellable(escrow.CancelAfter)) {
      addToast("This escrow is not yet cancellable.", "error");
      setCancelConfirmSeq(null);
      return;
    }
    setCancelConfirmSeq(null);
    setCancellingSeq(escrow.Sequence);
    setCancelTxStep(0);
    try {
      const unsignedTx = await escrowApi.prepareCancel({
        cancellerAddress: address,
        ownerAddress: escrow.Account,
        offerSequence: escrow.Sequence,
      });
      setCancelTxStep(1);
      const txBlob = await sign(unsignedTx);
      setCancelTxStep(2);
      await nftApi.submit(txBlob);
      setCancelTxStep(3);
      addToast("Escrow cancelled. Funds returned to escrow account.", "success");
      load(true);
    } catch (err) {
      addToast(translateXrplError(err), "error");
      setCancelTxStep(-1);
    } finally {
      setCancellingSeq(null);
    }
  };

  useEffect(() => {
    load(false);
    let id: ReturnType<typeof setInterval>;
    const jitter = setTimeout(() => {
      id = setInterval(() => {
        if (!cancellingRef.current) load(true);
      }, 15_000);
    }, Math.random() * 5_000);
    return () => { clearTimeout(jitter); clearInterval(id); };
  }, [load]);

  const displayEscrows = [
    ...escrows,
    ...removingEscrows.filter(re => !escrows.some(e => e.Sequence === re.Sequence)),
  ];

  return (
    <section className="form-card">
      <div className="row-space-between">
        <h2>Active Smart Escrows ({escrows.length})</h2>
        <button
          onClick={() => load(false)}
          disabled={loading}
          className="btn-secondary"
          style={{ fontSize: "0.65rem", padding: "0.25rem 0.6rem" }}
        >
          {loading ? "…" : "Refresh"}
        </button>
      </div>

      {loading ? (
        <>
          <SkeletonCard />
          <SkeletonCard />
        </>
      ) : displayEscrows.length === 0 ? (
        <div className="empty-state">
          <span>No active escrows on-chain.</span>
        </div>
      ) : (
        displayEscrows.map((e) => {
          const nftId = e.NftId ?? getNftId(e);
          const cancellable = isCancellable(e.CancelAfter);
          const isCancelling = cancellingSeq === e.Sequence;
          const isNew = newIds.has(escrowKey(e));
          const isRemoving = removingIds.has(escrowKey(e));
          return (
            <div
              key={e.Sequence}
              className={`result${isNew ? " result--new" : ""}${isRemoving ? " result--removing" : ""}`}
            >
              <Modal
                open={cancelConfirmSeq === e.Sequence}
                title="Cancel Escrow"
                danger
                message="Cancel this escrow? The locked XRP will be returned to the escrow account. This cannot be undone."
                confirmLabel="Cancel Escrow"
                onConfirm={() => handleCancel(e)}
                onCancel={() => setCancelConfirmSeq(null)}
              />
              <p><strong>Escrow Account</strong><br /><Copyable text={e.Account} truncate={12} /></p>
              <p><strong>Vendor (Destination)</strong><br /><Copyable text={e.Destination} truncate={12} /></p>
              <p><strong>Amount Locked</strong><br />{dropsToXrp(e.Amount)} — Sequence #{e.Sequence}</p>
              {nftId && <p><strong>NFT ID</strong><br /><Copyable text={nftId} truncate={12} /></p>}
              {e.CancelAfter && (
                <p className={`escrow-status-text ${cancellable ? "escrow-status-text--ok" : "escrow-status-text--muted"}`}>
                  {cancellable ? "✓ Cancellable now" : `Cancellable after ${formatExpiry(e.CancelAfter)}`}
                </p>
              )}
              {isCancelling && cancelTxStep >= 0 && (
                <Stepper steps={TX_STEPS} current={cancelTxStep} />
              )}
              <div className="btn-row">
                {onResume && (
                  <button
                    className="btn-secondary"
                    style={{ fontSize: "0.75rem" }}
                    onClick={() => onResume(e)}
                    disabled={isCancelling}
                  >
                    Resume →
                  </button>
                )}
                <button
                  className="btn-secondary btn-danger-outline"
                  style={{ fontSize: "0.75rem", color: cancellable ? "#9b2a2a" : undefined }}
                  onClick={() => setCancelConfirmSeq(e.Sequence)}
                  disabled={!cancellable || cancellingSeq !== null}
                >
                  {isCancelling ? "…" : "Cancel Escrow"}
                </button>
              </div>
            </div>
          );
        })
      )}
    </section>
  );
}
