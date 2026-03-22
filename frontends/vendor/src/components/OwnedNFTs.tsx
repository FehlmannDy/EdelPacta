import { useState, useEffect, forwardRef, useImperativeHandle } from "react";
import { nftApi, NFToken } from "../api/nft";
import { Copyable } from "./Copyable";
import { Stepper } from "./Stepper";
import { Modal } from "./Modal";
import { useToast } from "../context/ToastContext";
import { translateXrplError } from "../utils/xrplErrors";

interface Props {
  address: string;
  sign: (tx: Record<string, unknown>) => Promise<string>;
}

const TX_STEPS = ["Prepare", "Sign", "Submit"];

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
      await nftApi.submit(txBlob);
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
      <div style={{ display: "inline-flex", flexDirection: "column", gap: "0.25rem" }}>
        {txStep >= 0 && txStep < 3 && <Stepper steps={TX_STEPS} current={txStep} />}
        <button
          onClick={() => setConfirm(true)}
          disabled={loading}
          className="btn-nft-action"
          style={{ background: "transparent", border: "1px solid #9b2a2a", color: "#9b2a2a" }}
        >
          {loading ? "…" : "Burn"}
        </button>
      </div>
    </>
  );
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

export const OwnedNFTs = forwardRef<OwnedNFTsHandle, Props>(function OwnedNFTs({ address, sign }, ref) {
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
          <BurnButton nft={nft} address={address} sign={sign} onDone={load} />
        </div>
      ))}
    </section>
  );
});
