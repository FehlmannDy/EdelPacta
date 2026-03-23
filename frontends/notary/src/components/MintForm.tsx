import { Copyable } from "@shared/components/Copyable";
import { useToast } from "@shared/context/ToastContext";
import { nftLog } from "@shared/logger";
import { translateXrplError } from "@shared/utils/xrplErrors";
import { useState } from "react";
import { nftApi } from "../api/nft";

interface Props {
  onMinted?: () => void;
}

export function MintForm({ onMinted }: Props) {
  const defaultTaxon = "0";
  const defaultTransferFee = "0";
  const defaultTransferable = true;
  const { addToast } = useToast();
  const [vendorAddress, setVendorAddress] = useState("");
  const [taxon, setTaxon] = useState(defaultTaxon);
  const [transferFee, setTransferFee] = useState(defaultTransferFee);
  const [transferable, setTransferable] = useState(defaultTransferable);
  const [result, setResult] = useState<{ nftokenId: string; offerId: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = () => {
    const e: Record<string, string> = {};
    if (!vendorAddress.trim() || !/^r[a-zA-Z0-9]{24,}$/.test(vendorAddress.trim()))
      e.vendor = "Valid XRPL address required (starts with r…)";
    const taxonNum = parseInt(taxon, 10);
    if (isNaN(taxonNum) || taxonNum < 0 || !Number.isInteger(taxonNum))
      e.taxon = "Must be a non-negative integer.";
    const fee = parseInt(transferFee, 10);
    if (isNaN(fee) || fee < 0 || fee > 50000)
      e.transferFee = "Must be between 0 and 50000.";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleMint = async () => {
    if (!validate()) return;
    setLoading(true);
    setResult(null);
    try {
      setStatus("Minting deed on XRPL…");
      nftLog.info("issuer minting deed", { taxon, transferable, vendorAddress });
      const mintRes = await nftApi.issuerMint({
        taxon: parseInt(taxon, 10),
        transferFee: parseInt(transferFee, 10),
        flags: transferable ? 8 : 0,
        uri: "EdelPacta",
      });
      nftLog.info("NFT minted", { nftokenId: mintRes.nftokenId });

      setStatus("Creating transfer offer for vendor…");
      nftLog.info("issuer creating transfer offer", { nftokenId: mintRes.nftokenId, vendorAddress });
      const offerRes = await nftApi.issuerTransferOffer({
        nftokenId: mintRes.nftokenId,
        destination: vendorAddress.trim(),
      });
      nftLog.info("transfer offer created", { offerId: offerRes.offerId });

      setResult({ nftokenId: mintRes.nftokenId, offerId: offerRes.offerId });
      setVendorAddress("");
      setTaxon(defaultTaxon);
      setTransferFee(defaultTransferFee);
      setTransferable(defaultTransferable);
      setErrors({});
      addToast("Title deed issued and transfer offer sent to vendor.", "success");
      onMinted?.();
    } catch (err) {
      nftLog.error("mint/transfer failed", { err });
      addToast(translateXrplError(err), "error");
    } finally {
      setLoading(false);
      setStatus("");
    }
  };

  return (
    <section className="form-card">
      <h2>Issue & Transfer Title Deed</h2>

      <label>
        Vendor Address
        <input
          type="text"
          placeholder="rXXX… — vendor's XRPL address"
          value={vendorAddress}
          onChange={(e) => { setVendorAddress(e.target.value); setErrors((x) => ({ ...x, vendor: "" })); }}
          disabled={loading}
        />
        {errors.vendor && <span className="field-error">{errors.vendor}</span>}
      </label>

      <label>
        Registry Taxon
        <input type="number" min={0} value={taxon} disabled={loading} onChange={(e) => { setTaxon(e.target.value); setErrors((x) => ({ ...x, taxon: "" })); }} />
        {errors.taxon && <span className="field-error">{errors.taxon}</span>}
      </label>

      <label>
        Notary Fee (basis points, 0–50 000)
        <input type="number" min={0} max={50000} value={transferFee} disabled={loading} onChange={(e) => { setTransferFee(e.target.value); setErrors((x) => ({ ...x, transferFee: "" })); }} />
        {errors.transferFee && <span className="field-error">{errors.transferFee}</span>}
      </label>

      <label className="checkbox-label">
        <input type="checkbox" checked={transferable} disabled={loading} onChange={(e) => setTransferable(e.target.checked)} />
        Allow transfer to new owner
      </label>

      {loading && status && (
        <p style={{ fontSize: "0.82rem", color: "#8a7060", fontFamily: "system-ui" }}>
          <span className="spinner spinner--sm spinner--inline" /> {status}
        </p>
      )}

      <button onClick={handleMint} disabled={loading}>
        {loading ? "Processing…" : "Issue & Transfer Deed"}
      </button>

      {result && (
        <div className="result">
          <p><strong>Deed ID</strong><br /><Copyable text={result.nftokenId} truncate={10} /></p>
          <p><strong>Transfer Offer ID</strong><br /><Copyable text={result.offerId} truncate={10} /></p>
          <p className="result-note">Transfer offer sent to vendor. It will appear in Pending Transfer Offers below.</p>
        </div>
      )}
    </section>
  );
}
