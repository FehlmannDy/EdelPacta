import { useState, useEffect, forwardRef, useImperativeHandle } from "react";
import { QRCodeSVG } from "qrcode.react";
import { nftApi, NFToken, OfferDetails } from "../api/nft";
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

function SellOfferButton({ nft, address, sign, existingOfferId }: { nft: NFToken; address: string; sign: (tx: Record<string, unknown>) => Promise<string>; existingOfferId?: string }) {
  const { addToast } = useToast();
  const [open, setOpen] = useState(false);
  const [buyerAddress, setBuyerAddress] = useState("");
  const [buyerError, setBuyerError] = useState("");
  const [loading, setLoading] = useState(false);
  const [txStep, setTxStep] = useState(-1);
  const [offerDetails, setOfferDetails] = useState<OfferDetails | null>(null);
  const [showQR, setShowQR] = useState(false);

  useEffect(() => {
    if (!existingOfferId) return;
    nftApi.getOffer(existingOfferId).then(setOfferDetails).catch(() => {});
  }, [existingOfferId]);

  const validate = () => {
    if (!buyerAddress.trim() || !/^r[a-zA-Z0-9]{24,}$/.test(buyerAddress.trim())) {
      setBuyerError("Valid XRPL address required (starts with r…)");
      return false;
    }
    setBuyerError("");
    return true;
  };

  const handleCreate = async () => {
    if (!validate()) return;
    setLoading(true);
    setTxStep(0);
    try {
      const unsignedTx = await nftApi.prepareTransferOffer({
        account: address,
        nftokenId: nft.nftokenId,
        destination: buyerAddress.trim(),
        amount: "0",
      });
      setTxStep(1);
      const txBlob = await sign(unsignedTx);
      setTxStep(2);
      const result = await nftApi.submit(txBlob);
      setTxStep(3);
      if (!result.offerId) throw new Error("No offer ID returned");
      const details = await nftApi.getOffer(result.offerId);
      setOfferDetails(details);
      setOpen(false);
      setBuyerAddress("");
      addToast("Sell offer created successfully.", "success");
    } catch (err) {
      addToast(translateXrplError(err), "error");
      setTxStep(-1);
    } finally {
      setLoading(false);
    }
  };

  if (offerDetails) {
    const qrPayload = JSON.stringify({ offerId: offerDetails.offerId, sequence: offerDetails.sequence });
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        <p style={{ fontFamily: "system-ui", fontSize: "0.78rem", color: "#4a7a50", fontWeight: 600 }}>
          ✓ Sell offer active
        </p>
        <p style={{ fontFamily: "system-ui", fontSize: "0.72rem", color: "#8a7a68" }}>
          Offer ID: <Copyable text={offerDetails.offerId} truncate={10} />
          <br />
          Sequence: {offerDetails.sequence}
        </p>
        <button
          className="btn-nft-action"
          onClick={() => setShowQR((v) => !v)}
        >
          {showQR ? "Hide QR" : "Show QR for buyer"}
        </button>
        {showQR && (
          <div style={{ padding: "0.75rem", background: "#ede8dc", borderRadius: "8px", display: "inline-block" }}>
            <QRCodeSVG value={qrPayload} size={160} bgColor="#ede8dc" fgColor="#1a120a" />
            <p style={{ fontSize: "0.65rem", color: "#8a7a68", marginTop: "0.4rem", fontFamily: "system-ui", textAlign: "center" }}>
              Scan to get Offer ID + Sequence
            </p>
          </div>
        )}
      </div>
    );
  }

  if (open) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        <label style={{ fontFamily: "system-ui", fontSize: "0.78rem" }}>
          Buyer address
          <input
            type="text"
            placeholder="rXXX… buyer's XRPL address"
            value={buyerAddress}
            onChange={(e) => { setBuyerAddress(e.target.value); setBuyerError(""); }}
            disabled={loading}
            style={{ marginTop: "0.25rem" }}
          />
          {buyerError && <span className="field-error">{buyerError}</span>}
        </label>
        {txStep >= 0 && <Stepper steps={TX_STEPS} current={txStep} />}
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button onClick={handleCreate} disabled={loading} className="btn-nft-action">
            {loading ? "Creating…" : "Create Offer"}
          </button>
          <button onClick={() => { setOpen(false); setBuyerAddress(""); setBuyerError(""); }}
            disabled={loading} className="btn-nft-action"
            style={{ background: "transparent", border: "1px solid #c8bfb2", color: "#8a7a68" }}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <button className="btn-nft-action" onClick={() => setOpen(true)}>
      Create Sell Offer
    </button>
  );
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
  const [offersByNft, setOffersByNft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [result, outgoing] = await Promise.all([
        nftApi.list(address),
        nftApi.outgoingOffers(address),
      ]);
      setNfts(result.nfts);
      const map: Record<string, string> = {};
      for (const o of outgoing) {
        if (o.isSellOffer) map[o.nftokenId] = o.offerId;
      }
      setOffersByNft(map);
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
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "flex-start" }}>
            <SellOfferButton nft={nft} address={address} sign={sign} existingOfferId={offersByNft[nft.nftokenId]} />
            <BurnButton nft={nft} address={address} sign={sign} onDone={load} />
          </div>
        </div>
      ))}
    </section>
  );
});
