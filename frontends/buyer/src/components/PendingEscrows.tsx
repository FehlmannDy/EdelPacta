import { useState, useEffect } from "react";
import { escrowApi, EscrowObject } from "../api/escrow";
import { Copyable } from "@shared/components/Copyable";
import { SkeletonCard } from "@shared/components/SkeletonCard";
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

interface Props {
  address: string;
  onResume?: (escrow: EscrowObject) => void;
}

export function PendingEscrows({ address, onResume }: Props) {
  const [escrows, setEscrows] = useState<EscrowObject[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);

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
          return (
            <div key={e.Sequence} className="result">
              <p><strong>Escrow Account</strong><br /><Copyable text={e.Account} truncate={12} /></p>
              <p><strong>Seller (Destination)</strong><br /><Copyable text={e.Destination} truncate={12} /></p>
              <p><strong>Amount Locked</strong><br />{dropsToXrp(e.Amount)} — Sequence #{e.Sequence}</p>
              {nftId && <p><strong>NFT ID</strong><br /><Copyable text={nftId} truncate={12} /></p>}
              {e.CancelAfter && (
                <p><strong>Expires</strong><br />{formatExpiry(e.CancelAfter)}</p>
              )}
              {onResume && (
                <button
                  className="btn-secondary"
                  style={{ fontSize: "0.75rem", marginTop: "0.25rem" }}
                  onClick={() => onResume(e)}
                >
                  Resume →
                </button>
              )}
            </div>
          );
        })
      )}
    </section>
  );
}
