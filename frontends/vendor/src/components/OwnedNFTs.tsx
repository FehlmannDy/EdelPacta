import { useState, useEffect, forwardRef, useImperativeHandle } from "react";
import { nftApi, NFToken } from "../api/nft";
import { Copyable } from "./Copyable";
import { translateXrplError } from "../utils/xrplErrors";

interface Props {
  address: string;
}

export interface OwnedNFTsHandle { load: () => void; }

function SkeletonCard() {
  return (
    <div className="skeleton-card">
      <div className="skeleton skeleton-line skeleton-line--medium" />
      <div className="skeleton skeleton-line skeleton-line--long" />
      <div className="skeleton skeleton-line skeleton-line--short" />
    </div>
  );
}

export const OwnedNFTs = forwardRef<OwnedNFTsHandle, Props>(function OwnedNFTs({ address }, ref) {
  const [nfts, setNfts] = useState<NFToken[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await nftApi.list(address);
      setNfts(result.nfts);
    } catch (err) {
      setError(translateXrplError(err));
    } finally {
      setLoading(false);
    }
  };

  useImperativeHandle(ref, () => ({ load }));
  useEffect(() => { load(); }, [address]);

  return (
    <section className="form-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>My Deeds ({nfts.length})</h2>
        <button onClick={load} disabled={loading} className="btn-nft-action">
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
      {!loading && !error && nfts.length === 0 && (
        <div className="empty-state">
          <p>No deeds in your wallet yet.</p>
          <p>Accept an incoming offer above to receive your first title deed.</p>
        </div>
      )}

      {!loading && nfts.map((nft) => (
        <div key={nft.nftokenId} className="result">
          <p><strong>NFToken ID</strong><br /><Copyable text={nft.nftokenId} truncate={10} /></p>
          <p><strong>Issuer</strong><br /><Copyable text={nft.issuer} truncate={10} /></p>
          {nft.uri && (
            <p>
              <strong>Document</strong><br />
              {nft.uri.startsWith("ipfs://") ? (
                <a
                  href={`${import.meta.env.VITE_IPFS_GATEWAY}/${nft.uri.slice(7)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "#6b1728", wordBreak: "break-all" }}
                >
                  <Copyable text={nft.uri} truncate={20} />
                </a>
              ) : (
                <a href={nft.uri} target="_blank" rel="noopener noreferrer" style={{ color: "#6b1728", wordBreak: "break-all" }}>
                  {nft.uri}
                </a>
              )}
            </p>
          )}
          <p style={{ fontFamily: "system-ui", fontSize: "0.72rem", color: "#8a7a68" }}>
            Taxon {nft.taxon}
            {nft.transferFee > 0 && ` · Fee ${nft.transferFee / 1000}%`}
          </p>
        </div>
      ))}
    </section>
  );
});
