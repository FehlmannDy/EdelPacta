import { useState } from "react";
import { escrowApi, CreateEscrowResult } from "../api/escrow";
import { escrowLog } from "../logger";
import { Stepper } from "@shared/components/Stepper";
import { Copyable } from "@shared/components/Copyable";
import { useToast } from "@shared/context/ToastContext";

interface Props {
  buyerAddress: string;
  sign: (tx: Record<string, unknown>) => Promise<string>;
  onCreated: (result: CreateEscrowResult & { nftId: string; amountXrp: number }) => void;
}

const STEPS = ["Prepare Payment", "Sign with Otsu", "Create Escrow"];

export function EscrowCreate({ buyerAddress, sign, onCreated }: Props) {
  const { addToast } = useToast();
  const [sellerAddress, setSellerAddress] = useState("");
  const [nftId, setNftId] = useState("");
  const [amountXrp, setAmountXrp] = useState("");
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(-1);
  const [result, setResult] = useState<(CreateEscrowResult & { nftId: string; amountXrp: number }) | null>(null);
  const [reserveOverheadXrp, setReserveOverheadXrp] = useState<number | null>(null);
  const [errors, setErrors] = useState<{ seller?: string; nft?: string; amount?: string }>({});

  function validate() {
    const e: typeof errors = {};
    if (!sellerAddress.trim() || !/^r[a-zA-Z0-9]{24,}$/.test(sellerAddress.trim()))
      e.seller = "Valid XRPL address required (starts with r…)";
    if (!nftId.trim() || !/^[0-9A-Fa-f]{64}$/.test(nftId.trim()))
      e.nft = "NFT ID must be a 64-character hex string";
    const amt = parseFloat(amountXrp);
    if (isNaN(amt) || amt <= 0)
      e.amount = "Amount must be a positive number";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  const handleCreate = async () => {
    if (!validate()) return;
    setLoading(true);
    setStep(0);
    setResult(null);
    try {
      const amt = parseFloat(amountXrp);

      escrowLog.info("preparing payment tx", { buyerAddress, amountXrp });
      const { tx, reserveOverheadXrp: reserve } = await escrowApi.preparePayment({ buyerAddress, amountXrp: amt });
      setReserveOverheadXrp(reserve);

      setStep(1);
      escrowLog.info("signing payment with Otsu");
      const paymentTxBlob = await sign(tx);

      setStep(2);
      escrowLog.info("creating escrow", { sellerAddress, nftId });
      const res = await escrowApi.create({
        paymentTxBlob,
        buyerAddress,
        sellerAddress: sellerAddress.trim(),
        nftId: nftId.trim().toUpperCase(),
        amountXrp: amt,
      });

      escrowLog.info("escrow created", res);
      const full = { ...res, nftId: nftId.trim().toUpperCase(), amountXrp: amt };
      setResult(full);
      addToast(`Escrow created — ${amt} XRP locked on-chain.`, "success");
    } catch (err) {
      escrowLog.error("create failed", { err });
      addToast(err instanceof Error ? err.message : "Escrow creation failed", "error");
      setStep(-1);
    } finally {
      setLoading(false);
    }
  };

  if (result) {
    return (
      <section className="form-card">
        <h2>🔒 Escrow Created</h2>

        <div className="result">
          <p>
            <strong>Amount Locked</strong>
            <br />
            {result.amountXrp.toLocaleString()} XRP — Escrow #{result.escrowSequence}
          </p>
          {reserveOverheadXrp !== null && (
            <p style={{ fontSize: "0.82rem", color: "#8a7060" }}>
              <strong>Reserve Fee Paid</strong>
              <br />
              {reserveOverheadXrp.toLocaleString()} XRP (refunded to issuer when escrow settles)
            </p>
          )}
          <p>
            <strong>Escrow Account</strong>
            <br />
            <Copyable text={result.escrowAccount} truncate={12} />
          </p>
          <p>
            <strong>NFT ID</strong>
            <br />
            <Copyable text={result.nftId} truncate={12} />
          </p>
          <p>
            <strong>Transaction Hash</strong>
            <br />
            <Copyable text={result.hash} truncate={12} />
          </p>
        </div>

        <p className="info" style={{ fontSize: "0.82rem", lineHeight: 1.7 }}>
          XRP is locked in the WASM escrow. The notary will now verify
          the 6 conditions (KYC, NFT ownership, dual signatures) and release the funds.
        </p>
        <button onClick={() => onCreated(result)}>
          Continue to Finalize →
        </button>
      </section>
    );
  }

  return (
    <section className="form-card">
      <h2>Create Smart Escrow</h2>

      <p className="info" style={{ fontSize: "0.85rem", lineHeight: 1.7 }}>
        Lock XRP in a WASM-secured escrow. Your Otsu wallet will only sign a
        standard payment — no seed required.
      </p>

      <label>
        Seller Address
        <input
          type="text"
          placeholder="rXXX… — seller's XRPL address"
          value={sellerAddress}
          onChange={(e) => setSellerAddress(e.target.value)}
          disabled={loading}
        />
        {errors.seller && <span className="field-error">{errors.seller}</span>}
      </label>

      <label>
        NFT ID (Property Title)
        <input
          type="text"
          placeholder="64 hex chars — property title identifier"
          value={nftId}
          onChange={(e) => setNftId(e.target.value)}
          disabled={loading}
        />
        {errors.nft && <span className="field-error">{errors.nft}</span>}
      </label>

      <label>
        Amount (XRP)
        <div style={{ position: "relative" }}>
          <input
            type="number"
            placeholder="e.g. 100"
            min="0.01"
            step="0.01"
            value={amountXrp}
            onChange={(e) => setAmountXrp(e.target.value)}
            disabled={loading}
            style={{ paddingRight: "4.5rem" }}
          />
          <span style={{
            position: "absolute", right: "0.85rem", top: "50%", transform: "translateY(-50%)",
            fontSize: "0.78rem", fontWeight: 700, color: "#8a7060", pointerEvents: "none",
            letterSpacing: "0.04em",
          }}>
            XRP
          </span>
        </div>
        {errors.amount && <span className="field-error">{errors.amount}</span>}
      </label>

      {step >= 0 && (
        <div style={{ marginTop: "0.25rem" }}>
          <Stepper steps={STEPS} current={step} />
        </div>
      )}

      <button onClick={handleCreate} disabled={loading}>
        {loading ? (
          <><span className="spinner spinner--sm spinner--inline" /> Creating…</>
        ) : "Lock XRP in Escrow"}
      </button>
    </section>
  );
}
