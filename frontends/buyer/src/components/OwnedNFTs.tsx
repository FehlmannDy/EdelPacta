import { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";
import { nftApi, NftItem } from "../api/nft";
import { Copyable } from "@shared/components/Copyable";
import { SkeletonCard } from "@shared/components/SkeletonCard";

interface Props {
  address: string;
}

export interface OwnedNFTsHandle {
  load: () => void;
}

const nftKey = (nft: NftItem) => nft.nftokenId;

export const OwnedNFTs = forwardRef<OwnedNFTsHandle, Props>(({ address }, ref) => {
  const [nfts, setNfts] = useState<NftItem[]>([]);
  const [loading, setLoading] = useState(false);

  const latestLoadRef = useRef(0);
  const nftsRef = useRef<NftItem[]>([]);
  nftsRef.current = nfts;

  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
  const [removingNfts, setRemovingNfts] = useState<NftItem[]>([]);

  const load = useCallback(async (silent = false) => {
    const requestId = ++latestLoadRef.current;
    if (!silent) { setLoading(true); }
    try {
      const result = await nftApi.list(address);
      if (requestId !== latestLoadRef.current) return;
      if (silent) {
        const prev = nftsRef.current;
        const prevIds = new Set(prev.map(nftKey));
        const nextIds = new Set(result.map(nftKey));
        const added = result.filter(nft => !prevIds.has(nftKey(nft)));
        const removed = prev.filter(nft => !nextIds.has(nftKey(nft)));
        if (removed.length > 0) {
          setRemovingIds(new Set(removed.map(nftKey)));
          setRemovingNfts(removed);
          setTimeout(() => {
            if (requestId !== latestLoadRef.current) return;
            setNfts(result);
            setRemovingIds(new Set());
            setRemovingNfts([]);
          }, 350);
        } else {
          setNfts(result);
        }
        if (added.length > 0) {
          setNewIds(new Set(added.map(nftKey)));
          setTimeout(() => setNewIds(new Set()), 2500);
        }
      } else {
        setNfts(result);
        setNewIds(new Set());
        setRemovingIds(new Set());
        setRemovingNfts([]);
      }
    } catch (_) {
      if (requestId !== latestLoadRef.current) return;
    } finally {
      if (requestId !== latestLoadRef.current) return;
      if (!silent) setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    load(false);
    let id: ReturnType<typeof setInterval>;
    const jitter = setTimeout(() => {
      id = setInterval(() => { load(true); }, 15_000);
    }, Math.random() * 5_000);
    return () => { clearTimeout(jitter); clearInterval(id); };
  }, [load]);

  useImperativeHandle(ref, () => ({ load: () => load(true) }), [load]);

  const displayNfts = [
    ...nfts,
    ...removingNfts.filter(rn => !nfts.some(n => n.nftokenId === rn.nftokenId)),
  ];

  return (
    <section className="form-card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2>Property Titles Held</h2>
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
      ) : displayNfts.length === 0 ? (
        <div className="empty-state">
          <span>No property title deeds held yet.</span>
          <span>Complete the escrow process to receive one.</span>
        </div>
      ) : (
        displayNfts.map((nft) => {
          const isNew = newIds.has(nftKey(nft));
          const isRemoving = removingIds.has(nftKey(nft));
          return (
            <div
              key={nft.nftokenId}
              className={`result${isNew ? " result--new" : ""}${isRemoving ? " result--removing" : ""}`}
            >
              <p><strong>NFT ID</strong><br /><Copyable text={nft.nftokenId} truncate={10} /></p>
              {nft.uri && <p><strong>URI</strong><br /><span style={{ wordBreak: "break-all" }}>{nft.uri}</span></p>}
            </div>
          );
        })
      )}
    </section>
  );
});
