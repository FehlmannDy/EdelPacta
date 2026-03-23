import { useState, useEffect, forwardRef, useImperativeHandle } from "react";
import { nftApi, NFToken } from "../api/nft";
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
              <strong>URI</strong><br />
              <span style={{ fontFamily: "system-ui", fontSize: "0.78rem", color: "#5a4a3a", wordBreak: "break-all" }}>{nft.uri}</span>
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
