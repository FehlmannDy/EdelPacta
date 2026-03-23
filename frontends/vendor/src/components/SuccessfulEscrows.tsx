import { Copyable } from "@shared/components/Copyable";
import { SkeletonCard } from "@shared/components/SkeletonCard";
import { dropsToXrp } from "@shared/utils/xrplEpoch";
import { useCallback, useEffect, useRef, useState } from "react";
import { escrowApi, SuccessfulEscrow } from "../api/escrow";

interface Props {
  address: string;
}

function escrowKey(e: SuccessfulEscrow): string {
  return `${e.escrowSequence}-${e.escrowFinishHash ?? "pending"}`;
}

export function SuccessfulEscrows({ address }: Props) {
  const [escrows, setEscrows] = useState<SuccessfulEscrow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latestLoadRef = useRef(0);
  const escrowsRef = useRef<SuccessfulEscrow[]>([]);
  escrowsRef.current = escrows;

  const [newIds, setNewIds] = useState<Set<string>>(new Set());

  const load = useCallback(async (silent = false) => {
    const requestId = ++latestLoadRef.current;
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const { escrows: list } = await escrowApi.successfulBySeller(address);
      if (requestId !== latestLoadRef.current) return;
      if (silent) {
        const prevKeys = new Set(escrowsRef.current.map(escrowKey));
        const added = list.filter(e => !prevKeys.has(escrowKey(e)));
        setEscrows(list);
        if (added.length > 0) {
          setNewIds(new Set(added.map(escrowKey)));
          setTimeout(() => setNewIds(new Set()), 2500);
        }
      } else {
        setEscrows(list);
        setNewIds(new Set());
      }
    } catch (err) {
      if (requestId !== latestLoadRef.current) return;
      if (!silent) setError(err instanceof Error ? err.message : "Failed to load successful escrows");
    } finally {
      if (requestId !== latestLoadRef.current) return;
      if (!silent) setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    load(false);
    let id: ReturnType<typeof setInterval>;
    const jitter = setTimeout(() => {
      id = setInterval(() => load(true), 15_000);
    }, Math.random() * 5_000);
    return () => { clearTimeout(jitter); clearInterval(id); };
  }, [load]);

  return (
    <section className="form-card">
      <div className="row-space-between">
        <h2>Successful Smart Escrows ({escrows.length})</h2>
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
        ) : escrows.length === 0 ? (
          <div className="empty-state">
            <p>No successful smart escrows yet.</p>
            <p>Escrows will appear here once EscrowFinish is validated.</p>
          </div>
        ) : (
          escrows.map((e) => {
            const key = escrowKey(e);
            const isNew = newIds.has(key);
            return (
              <div
                key={key}
                className={`result${isNew ? " result--new" : ""}`}
              >
                <p><strong>Amount Settled</strong><br />{dropsToXrp(e.amountDrops)} — Sequence #{e.escrowSequence}</p>
                {e.nftId && <p><strong>Deed (NFT ID)</strong><br /><Copyable text={e.nftId} truncate={12} /></p>}
                {e.buyerAddress && <p><strong>Buyer</strong><br /><Copyable text={e.buyerAddress} truncate={12} /></p>}
                {e.escrowFinishHash && <p><strong>EscrowFinish Tx</strong><br /><Copyable text={e.escrowFinishHash} truncate={10} /></p>}
                {e.finishedAt && (
                  <p className="escrow-status-text escrow-status-text--ok">
                    Finished on {new Date(e.finishedAt).toLocaleString()}
                  </p>
                )}
              </div>
            );
          })
        )
      )}
    </section>
  );
}
