import { useState, useEffect, useImperativeHandle, forwardRef } from "react";
import { escrowApi, NftItem } from "../api/escrow";
import { Copyable } from "./Copyable";

interface Props {
  address: string;
}

export interface OwnedNFTsHandle {
  load: () => void;
}

export const OwnedNFTs = forwardRef<OwnedNFTsHandle, Props>(({ address }, ref) => {
  const [nfts, setNfts] = useState<NftItem[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { nfts: list } = await escrowApi.nfts(address);
      setNfts(list);
    } catch (_) {
      // silent
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [address]);
  useImperativeHandle(ref, () => ({ load }));

  return (
    <section className="form-card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2>Property Titles Held</h2>
        <button
          onClick={load}
          disabled={loading}
          className="btn-secondary"
          style={{ fontSize: "0.65rem", padding: "0.25rem 0.6rem" }}
        >
          {loading ? "…" : "Refresh"}
        </button>
      </div>

      {loading && nfts.length === 0 ? (
        <div className="spinner" />
      ) : nfts.length === 0 ? (
        <div className="empty-state">
          <span>No property title deeds held yet.</span>
          <span>Complete the escrow process to receive one.</span>
        </div>
      ) : (
        nfts.map((nft) => (
          <div key={nft.nftokenId} className="result">
            <p><strong>NFT ID</strong><br /><Copyable text={nft.nftokenId} truncate={10} /></p>
            {nft.uri && <p><strong>URI</strong><br /><span style={{ wordBreak: "break-all" }}>{nft.uri}</span></p>}
          </div>
        ))
      )}
    </section>
  );
});
