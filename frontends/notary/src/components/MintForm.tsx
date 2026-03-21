import { useState } from "react";
import { nftApi, SubmitResult } from "../api/nft";
import { nftLog } from "../logger";
import { Copyable } from "./Copyable";
import { Stepper } from "./Stepper";
import { useToast } from "../context/ToastContext";
import { translateXrplError } from "../utils/xrplErrors";

interface Props {
  address: string;
  sign: (tx: Record<string, unknown>) => Promise<string>;
  onMinted?: () => void;
}

const TX_STEPS = ["Prepare", "Sign", "Submit"];

export function MintForm({ address, sign, onMinted }: Props) {
  const { addToast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [uri, setUri] = useState("");
  const [taxon, setTaxon] = useState("0");
  const [transferFee, setTransferFee] = useState("0");
  const [transferable, setTransferable] = useState(true);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [txStep, setTxStep] = useState(-1);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = () => {
    const e: Record<string, string> = {};
    const taxonNum = parseInt(taxon, 10);
    if (isNaN(taxonNum) || taxonNum < 0 || !Number.isInteger(taxonNum)) {
      e.taxon = "Must be a non-negative integer.";
    }
    const fee = parseInt(transferFee, 10);
    if (isNaN(fee) || fee < 0 || fee > 50000) {
      e.transferFee = "Must be between 0 and 50000.";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] ?? null;
    setFile(selected);
    if (!selected) return;
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("file", selected);
      const res = await fetch("/api/ipfs/upload", { method: "POST", body: formData });
      if (!res.ok) throw new Error(await res.text());
      const { uri: ipfsUri } = await res.json() as { cid: string; uri: string };
      setUri(ipfsUri);
      addToast("Document pinned to IPFS.", "success");
      nftLog.info("file pinned to IPFS", { ipfsUri });
    } catch (err) {
      nftLog.error("IPFS upload failed", { err });
      addToast(translateXrplError(err), "error");
    } finally {
      setLoading(false);
    }
  };

  const handleMint = async () => {
    if (!validate()) return;
    setLoading(true);
    setResult(null);
    setTxStep(0);
    try {
      nftLog.info("preparing mint tx", { account: address, taxon, transferable });
      const unsignedTx = await nftApi.prepareMint({
        account: address,
        taxon: parseInt(taxon, 10),
        uri: uri || undefined,
        transferFee: parseInt(transferFee, 10),
        flags: transferable ? 8 : 0,
      });

      setTxStep(1);
      const txBlob = await sign(unsignedTx);

      setTxStep(2);
      nftLog.info("submitting mint tx");
      const res = await nftApi.submit(txBlob);
      nftLog.info("NFT minted", { nftokenId: res.nftokenId, txHash: res.txHash });
      setTxStep(3);
      setResult(res);
      addToast("Title deed registered on XRPL.", "success");
      onMinted?.();
    } catch (err) {
      nftLog.error("mint failed", { err });
      addToast(translateXrplError(err), "error");
      setTxStep(-1);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="form-card">
      <h2>Register New Title Deed</h2>

      <label>
        Upload Deed Document
        <input type="file" accept=".pdf,.doc,.docx,.png,.jpg" disabled={loading} onChange={handleFileChange} />
        {file && <span className="file-name">{file.name}</span>}
      </label>

      <label>
        Document URI
        <input
          type="text"
          placeholder="ipfs://Qm… — auto-filled after upload, or enter manually"
          value={uri}
          onChange={(e) => setUri(e.target.value)}
        />
      </label>

      <label>
        Registry Taxon
        <input type="number" min={0} value={taxon} onChange={(e) => { setTaxon(e.target.value); setErrors((x) => ({ ...x, taxon: "" })); }} />
        {errors.taxon && <span className="field-error">{errors.taxon}</span>}
      </label>

      <label>
        Notary Fee (basis points, 0–50 000)
        <input type="number" min={0} max={50000} value={transferFee} onChange={(e) => { setTransferFee(e.target.value); setErrors((x) => ({ ...x, transferFee: "" })); }} />
        {errors.transferFee && <span className="field-error">{errors.transferFee}</span>}
      </label>

      <label className="checkbox-label">
        <input type="checkbox" checked={transferable} onChange={(e) => setTransferable(e.target.checked)} />
        Allow transfer to new owner
      </label>

      {txStep >= 0 && <Stepper steps={TX_STEPS} current={txStep} />}

      <button onClick={handleMint} disabled={loading}>
        {loading ? "Registering…" : "Issue Title Deed"}
      </button>

      {result && (
        <div className="result">
          <p><strong>Deed ID</strong><br /><Copyable text={result.nftokenId!} truncate={10} /></p>
          <p><strong>Tx Hash</strong><br /><Copyable text={result.txHash} truncate={10} /></p>
          <p className="result-note">Save the Deed ID — the recipient will need it to accept the transfer.</p>
        </div>
      )}
    </section>
  );
}
