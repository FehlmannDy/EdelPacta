import { useState, useEffect, useImperativeHandle, forwardRef, useRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import { nftApi, NFToken } from "../api/nft";
import { kycApi, CredentialStatus } from "../api/kyc";
import { nftLog } from "../logger";
import { Copyable } from "./Copyable";
import { Stepper } from "./Stepper";
import { Modal } from "./Modal";
import { useToast } from "../context/ToastContext";
import { translateXrplError } from "../utils/xrplErrors";

interface Props {
  address: string;
  sign: (tx: Record<string, unknown>) => Promise<string>;
  onTransfer?: () => void;
  onBurned?: () => void;
}

export interface NFTListHandle {
  load: () => void;
}

const FLAG_LABELS: Record<number, string> = {
  0x01: "Burnable", 0x02: "OnlyXRP", 0x08: "Transferable", 0x10: "Mutable",
};

function parseFlags(flags: number): string[] {
  return Object.entries(FLAG_LABELS).filter(([hex]) => flags & parseInt(hex)).map(([, l]) => l);
}

const TX_STEPS = ["Prepare", "Sign", "Submit"];

function SkeletonCard() {
  return (
    <div className="skeleton-card">
      <div className="skeleton skeleton-line skeleton-line--medium" />
      <div className="skeleton skeleton-line skeleton-line--long" />
      <div className="skeleton skeleton-line skeleton-line--short" />
    </div>
  );
}

interface TransferRowProps {
  nft: NFToken;
  address: string;
  sign: (tx: Record<string, unknown>) => Promise<string>;
  onDone: () => void;
  onTransfer?: () => void;
}

function TransferRow({ nft, address, sign, onDone, onTransfer }: TransferRowProps) {
  const { addToast } = useToast();
  const [destination, setDestination] = useState("");
  const [offerId, setOfferId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [txStep, setTxStep] = useState(-1);
  const [destError, setDestError] = useState("");
  const [kycStatus, setKycStatus] = useState<{ identity: CredentialStatus; tax: CredentialStatus } | null>(null);
  const [kycChecking, setKycChecking] = useState(false);
  const kycDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (kycDebounce.current) clearTimeout(kycDebounce.current);
    const isValidDest = destination.length >= 25 && destination.startsWith("r");
    if (!isValidDest) { setKycStatus(null); setKycChecking(false); return; }
    setKycChecking(true);
    kycDebounce.current = setTimeout(async () => {
      try {
        const status = await kycApi.checkVendorKYC(destination);
        setKycStatus(status);
      } catch {
        setKycStatus(null);
      } finally {
        setKycChecking(false);
      }
    }, 600);
    return () => { if (kycDebounce.current) clearTimeout(kycDebounce.current); };
  }, [destination]);

  const validateDest = (val: string) => {
    if (val && (val.length < 25 || !val.startsWith("r"))) return "XRPL address must start with 'r' (25–34 chars).";
    return "";
  };

  const handleTransfer = async () => {
    const err = validateDest(destination);
    if (err) { setDestError(err); return; }
    setLoading(true);
    setOfferId(null);
    setTxStep(0);
    try {
      // Verify vendor has both KYC credentials before transferring
      if (destination) {
        nftLog.info("checking vendor KYC", { destination });
        const kyc = await kycApi.checkVendorKYC(destination);
        if (kyc.identity !== "accepted" || kyc.tax !== "accepted") {
          const missing = [
            kyc.identity !== "accepted" && "ID",
            kyc.tax !== "accepted" && "Estate",
          ].filter(Boolean).join(" and ");
          setDestError(`Recipient has not completed KYC (missing: ${missing} credential).`);
          setTxStep(-1);
          setLoading(false);
          return;
        }
      }

      nftLog.info("preparing transfer offer", { nftokenId: nft.nftokenId });
      const unsignedTx = await nftApi.prepareTransferOffer({ account: address, nftokenId: nft.nftokenId, destination: destination || undefined });
      setTxStep(1);
      const txBlob = await sign(unsignedTx);
      setTxStep(2);
      const result = await nftApi.submit(txBlob);
      nftLog.info("transfer offer created", { offerId: result.offerId });
      setTxStep(3);
      setOfferId(result.offerId ?? null);
      addToast("Transfer offer created. Share the Offer ID with the recipient.", "success");
      onDone();
      onTransfer?.();
    } catch (err) {
      nftLog.error("transfer offer failed", { err });
      addToast(translateXrplError(err), "error");
      setTxStep(-1);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="transfer-row">
      <label style={{ textTransform: "uppercase", fontSize: "0.68rem", letterSpacing: "0.15em", color: "#8a7a68", fontFamily: "system-ui" }}>
        Recipient Address
        <input
          type="text"
          placeholder="rXxx… — leave empty for open offer"
          value={destination}
          onChange={(e) => { setDestination(e.target.value); setDestError(validateDest(e.target.value)); }}
        />
        {destError && <span className="field-error">{destError}</span>}
      </label>
      {(kycChecking || kycStatus) && (
        <div className="vendor-kyc-status">
          {kycChecking ? (
            <span className="vendor-kyc-checking"><span className="spinner spinner--sm spinner--inline" /> Checking KYC…</span>
          ) : kycStatus && (
            <>
              <span className={`vendor-kyc-badge ${kycStatus.identity === "accepted" ? "vendor-kyc-badge--ok" : "vendor-kyc-badge--fail"}`}>
                {kycStatus.identity === "accepted" ? "✓" : "✗"} ID Verified
              </span>
              <span className={`vendor-kyc-badge ${kycStatus.tax === "accepted" ? "vendor-kyc-badge--ok" : "vendor-kyc-badge--fail"}`}>
                {kycStatus.tax === "accepted" ? "✓" : "✗"} Estate Verified
              </span>
            </>
          )}
        </div>
      )}
      {txStep >= 0 && <Stepper steps={TX_STEPS} current={txStep} />}
      <button
        onClick={handleTransfer}
        disabled={loading || !destination || kycChecking || !kycStatus || kycStatus.identity !== "accepted" || kycStatus.tax !== "accepted"}
        className="btn-nft-action"
      >{loading ? "…" : "Send"}</button>
      {offerId && (
        <div className="result" style={{ marginTop: "0.5rem" }}>
          <p><strong>Offer ID</strong> — share with recipient<br /><Copyable text={offerId} truncate={10} /></p>
          <div style={{ display: "flex", justifyContent: "center", padding: "0.75rem 0" }}>
            <QRCodeSVG value={offerId} size={160} bgColor="#ede8dc" fgColor="#1a120a" />
          </div>
        </div>
      )}
    </div>
  );
}

function BurnButton({ nft, address, sign, onDone, onBurned }: { nft: NFToken; address: string; sign: (tx: Record<string, unknown>) => Promise<string>; onDone: () => void; onBurned?: () => void }) {
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
      onBurned?.();
    } catch (err) {
      nftLog.error("burn failed", { err });
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

export const NFTList = forwardRef<NFTListHandle, Props>(function NFTList({ address, sign, onTransfer, onBurned }, ref) {
  const [nfts, setNfts] = useState<NFToken[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
      {!loading && nfts.length === 0 && !error && (
        <div className="empty-state">
          <p>No deeds registered yet.</p>
          <p>Use the form below to issue your first title deed on the XRP Ledger.</p>
        </div>
      )}

      {nfts.map((nft) => {
        const transferable = !!(nft.flags & 0x08);
        const isExpanded = expandedId === nft.nftokenId;
        return (
          <div key={nft.nftokenId} className="result">
            <p><strong>NFToken ID</strong><br /><Copyable text={nft.nftokenId} truncate={10} /></p>
            {nft.uri && (
              <p>
                <strong>Document</strong><br />
                {nft.uri.startsWith("ipfs://") ? (
                  <a href={`${import.meta.env.VITE_IPFS_GATEWAY}/${nft.uri.slice(7)}`} target="_blank" rel="noopener noreferrer" style={{ wordBreak: "break-all", color: "#6b1728" }}>
                    <Copyable text={nft.uri} truncate={20}>{nft.uri.replace("ipfs://", "ipfs://").slice(0, 30) + "…"}</Copyable>
                  </a>
                ) : (
                  <a href={nft.uri} target="_blank" rel="noopener noreferrer" style={{ wordBreak: "break-all", color: "#6b1728" }}>{nft.uri}</a>
                )}
              </p>
            )}
            <p style={{ fontSize: "0.72rem", color: "#8a7a68", fontFamily: "system-ui" }}>
              Taxon {nft.taxon} · Fee {nft.transferFee / 1000}% · {parseFlags(nft.flags).join(", ") || "No flags"}
            </p>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "flex-start" }}>
              {transferable && (
                <button onClick={() => setExpandedId(isExpanded ? null : nft.nftokenId)} className="btn-nft-action">
                  {isExpanded ? "Cancel" : "Transfer"}
                </button>
              )}
              <BurnButton nft={nft} address={address} sign={sign} onDone={() => { setExpandedId(null); load(); }} onBurned={onBurned} />
            </div>
            {isExpanded && (
              <TransferRow nft={nft} address={address} sign={sign} onDone={() => { setExpandedId(null); load(); }} onTransfer={onTransfer} />
            )}
          </div>
        );
      })}
    </section>
  );
});
