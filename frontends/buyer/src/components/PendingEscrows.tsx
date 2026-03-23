import { useState, useEffect } from "react";
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

const XRPL_EPOCH_OFFSET = 946684800;

function isCancellable(cancelAfter: number | undefined): boolean {
  if (!cancelAfter) return true;
  return Date.now() / 1000 - XRPL_EPOCH_OFFSET >= cancelAfter;
}

const TX_STEPS = ["Prepare", "Sign", "Submit"];

interface Props {
  address: string;
  sign: (tx: Record<string, unknown>) => Promise<string>;
  onResume?: (escrow: EscrowObject) => void;
}

export function PendingEscrows({ address, sign, onResume }: Props) {
  const { addToast } = useToast();
  const [escrows, setEscrows] = useState<EscrowObject[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const [cancelConfirmSeq, setCancelConfirmSeq] = useState<number | null>(null);
  const [cancellingSeq, setCancellingSeq] = useState<number | null>(null);
  const [cancelTxStep, setCancelTxStep] = useState(-1);

  const load = async () => {
    setLoading(true);
    try {
      const { escrows: list } = await escrowApi.byBuyer(address);
      setEscrows(list as EscrowObject[]);
    } catch (_) {
      // silent
    } finally {
      setLoading(false);
      setInitialLoad(false);
    }
  };

  const handleCancel = async (escrow: EscrowObject) => {
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
      load();
    } catch (err) {
      addToast(translateXrplError(err), "error");
      setCancelTxStep(-1);
    } finally {
      setCancellingSeq(null);
    }
  };

  useEffect(() => { load(); }, [address]);

  return (
    <section className="form-card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2>Active Smart Escrows</h2>
        <button
          onClick={load}
          disabled={loading}
          className="btn-secondary"
          style={{ fontSize: "0.65rem", padding: "0.25rem 0.6rem" }}
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
          <span>No active escrows on-chain.</span>
        </div>
      ) : (
        escrows.map((e) => {
          const nftId = e.NftId ?? getNftId(e);
          const cancellable = isCancellable(e.CancelAfter);
          const isCancelling = cancellingSeq === e.Sequence;
          return (
            <div key={e.Sequence} className="result">
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
                <p style={{ fontFamily: "system-ui", fontSize: "0.78rem", color: cancellable ? "#4a7a50" : "#8a7a68" }}>
                  {cancellable ? "✓ Cancellable now" : `Cancellable after ${formatExpiry(e.CancelAfter)}`}
                </p>
              )}
              {isCancelling && cancelTxStep >= 0 && (
                <Stepper steps={TX_STEPS} current={cancelTxStep} />
              )}
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
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
                  className="btn-secondary"
                  style={{ fontSize: "0.75rem", background: "transparent", border: "1px solid #9b2a2a", color: cancellable ? "#9b2a2a" : undefined }}
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
