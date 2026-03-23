import { Copyable } from "@shared/components/Copyable";
import { SkeletonCard } from "@shared/components/SkeletonCard";
import { dropsToXrp } from "@shared/utils/xrplEpoch";
import { useEffect, useState } from "react";
import { escrowApi, SuccessfulEscrow } from "../api/escrow";

interface Props {
  address: string;
}

export function SuccessfulEscrows({ address }: Props) {
  const [escrows, setEscrows] = useState<SuccessfulEscrow[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const { escrows: list } = await escrowApi.successfulBySeller(address);
      setEscrows(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load successful escrows");
    } finally {
      setLoading(false);
      setInitialLoad(false);
    }
  };

  useEffect(() => {
    void load();
  }, [address]);

  return (
    <section className="form-card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2>Successful Smart Escrows</h2>
        <button onClick={() => void load()} disabled={loading} className="btn-nft-action">
          {loading ? "..." : "Refresh"}
        </button>
      </div>

      {loading && initialLoad ? (
        <>
          <SkeletonCard />
          <SkeletonCard />
        </>
      ) : error ? (
        <p className="error">{error}</p>
      ) : escrows.length === 0 ? (
        <div className="empty-state">
          <p>No successful smart escrows yet.</p>
          <p>Escrows will appear here once EscrowFinish is validated.</p>
        </div>
      ) : (
        escrows.map((e) => (
          <div key={`${e.escrowSequence}-${e.escrowFinishHash ?? "pending"}`} className="result">
            <p><strong>Amount Settled</strong><br />{dropsToXrp(e.amountDrops)} — Sequence #{e.escrowSequence}</p>
            {e.nftId && <p><strong>Deed (NFT ID)</strong><br /><Copyable text={e.nftId} truncate={12} /></p>}
            {e.buyerAddress && <p><strong>Buyer</strong><br /><Copyable text={e.buyerAddress} truncate={12} /></p>}
            {e.escrowFinishHash && <p><strong>EscrowFinish Tx</strong><br /><Copyable text={e.escrowFinishHash} truncate={10} /></p>}
            {e.finishedAt && (
              <p style={{ fontFamily: "system-ui", fontSize: "0.78rem", color: "#4a7a50" }}>
                Finished on {new Date(e.finishedAt).toLocaleString()}
              </p>
            )}
          </div>
        ))
      )}
    </section>
  );
}
