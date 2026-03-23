import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { nftApi, submitTx, NFToken } from "../api/nft";
import { Copyable } from "@shared/components/Copyable";
import { Stepper } from "@shared/components/Stepper";
import { Modal } from "@shared/components/Modal";
import { SkeletonCard } from "@shared/components/SkeletonCard";
import { useToast } from "@shared/context/ToastContext";
import { translateXrplError } from "@shared/utils/xrplErrors";
import { TX_STEPS } from "../constants";

interface Props {
  address: string;
  sign: (tx: Record<string, unknown>) => Promise<string>;
}

function BurnButton({ nft, address, sign, onDone }: { nft: NFToken; address: string; sign: (tx: Record<string, unknown>) => Promise<string>; onDone: () => void }) {
  const { addToast } = useToast();
  const [confirm, setConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [txStep, setTxStep] = useState(-1);

  const handleBurn = async () => {
    setConfirm(false);
    setLoading(true);
    setTxStep(0);
    try {
      const unsignedTx = await nftApi.prepareBurn({ account: address, nftokenId: nft.nftokenId });
      setTxStep(1);
      const txBlob = await sign(unsignedTx);
      setTxStep(2);
      await submitTx(txBlob);
      setTxStep(3);
      addToast("Deed burned and removed from the ledger.", "success");
      onDone();
    } catch (err) {
      addToast(translateXrplError(err), "error");
      setTxStep(-1);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Modal
        open={confirm}
        title="Burn Deed"
        danger
        message="Permanently burn this deed? This action cannot be undone and will remove it from the ledger."
        confirmLabel="Burn"
        onConfirm={handleBurn}
        onCancel={() => setConfirm(false)}
      />
      <div className="burn-btn-wrap">
        {txStep >= 0 && txStep < 3 && <Stepper steps={TX_STEPS} current={txStep} />}
        <button
          onClick={() => setConfirm(true)}
          disabled={loading}
          className="btn-nft-action btn-danger-outline"
        >
          {loading ? "…" : "Burn"}
        </button>
      </div>
    </>
  );
}

export interface OwnedNFTsHandle { load: () => void; }

export const OwnedNFTs = forwardRef<OwnedNFTsHandle, Props>(function OwnedNFTs({ address, sign }, ref) {
  const [nfts, setNfts] = useState<NFToken[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latestLoadRef = useRef(0);
  const nftsRef = useRef<NFToken[]>([]);
  nftsRef.current = nfts;

  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
  const [removingNfts, setRemovingNfts] = useState<NFToken[]>([]);

  const load = useCallback(async (silent = false) => {
    const requestId = ++latestLoadRef.current;
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const result = await nftApi.list(address);
      if (requestId !== latestLoadRef.current) return;
      if (silent) {
        const prev = nftsRef.current;
        const prevIds = new Set(prev.map(n => n.nftokenId));
        const nextIds = new Set(result.nfts.map(n => n.nftokenId));
        const added = result.nfts.filter(n => !prevIds.has(n.nftokenId));
        const removed = prev.filter(n => !nextIds.has(n.nftokenId));
        if (removed.length > 0) {
          setRemovingIds(new Set(removed.map(n => n.nftokenId)));
          setRemovingNfts(removed);
          setTimeout(() => {
            if (requestId !== latestLoadRef.current) return;
            setNfts(result.nfts);
            setRemovingIds(new Set());
            setRemovingNfts([]);
          }, 350);
        } else {
          setNfts(result.nfts);
        }
        if (added.length > 0) {
          setNewIds(new Set(added.map(n => n.nftokenId)));
          setTimeout(() => setNewIds(new Set()), 2500);
        }
      } else {
        setNfts(result.nfts);
        setNewIds(new Set());
        setRemovingIds(new Set());
        setRemovingNfts([]);
      }
    } catch (err) {
      if (requestId !== latestLoadRef.current) return;
      if (!silent) setError(translateXrplError(err));
    } finally {
      if (requestId !== latestLoadRef.current) return;
      if (!silent) setLoading(false);
    }
  }, [address]);

  // Expose silent load so parent can trigger it after cross-section actions
  // (e.g. IncomingOffers accepted → NFT appears here with "new" animation)
  useImperativeHandle(ref, () => ({ load: () => load(true) }), [load]);

  useEffect(() => {
    load(false);
    let id: ReturnType<typeof setInterval>;
    const jitter = setTimeout(() => {
      id = setInterval(() => load(true), 15_000);
    }, Math.random() * 5_000);
    return () => { clearTimeout(jitter); clearInterval(id); };
  }, [load]);

  const displayNfts = [
    ...nfts,
    ...removingNfts.filter(rn => !nfts.some(n => n.nftokenId === rn.nftokenId)),
  ];

  return (
    <section className="form-card">
      <div className="row-space-between">
        <h2>My Deeds ({nfts.length})</h2>
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
      {!loading && error && <p className="error">{error}</p>}
      {!loading && !error && displayNfts.length === 0 && (
        <div className="empty-state">
          <p>No deeds in your wallet yet.</p>
          <p>Accept an incoming offer above to receive your first title deed.</p>
        </div>
      )}

      {!loading && displayNfts.map((nft) => {
        const isNew = newIds.has(nft.nftokenId);
        const isRemoving = removingIds.has(nft.nftokenId);
        return (
          <div
            key={nft.nftokenId}
            className={`result${isNew ? " result--new" : ""}${isRemoving ? " result--removing" : ""}`}
          >
            <p><strong>NFToken ID</strong><br /><Copyable text={nft.nftokenId} truncate={10} /></p>
            <p><strong>Issuer</strong><br /><Copyable text={nft.issuer} truncate={10} /></p>
            {nft.uri && (
              <p>
                <strong>URI</strong><br />
                <span className="nft-uri">{nft.uri}</span>
              </p>
            )}
            <p className="nft-meta">
              Taxon {nft.taxon}
              {nft.transferFee > 0 && ` · Fee ${nft.transferFee / 1000}%`}
            </p>
            <BurnButton nft={nft} address={address} sign={sign} onDone={() => load(true)} />
          </div>
        );
      })}
    </section>
  );
});
