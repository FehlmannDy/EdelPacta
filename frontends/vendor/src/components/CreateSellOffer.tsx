import { useState } from "react";
import { nftApi, SubmitResult } from "../api/nft";
import { nftLog } from "@shared/logger";
import { Stepper } from "@shared/components/Stepper";
import { Copyable } from "@shared/components/Copyable";
import { useToast } from "@shared/context/ToastContext";
import { translateXrplError } from "@shared/utils/xrplErrors";
import { TX_STEPS } from "../constants";

interface Props {
  address: string;
  sign: (tx: Record<string, unknown>) => Promise<string>;
  onCreated?: () => void;
}

const XRPL_ADDRESS = /^r[a-zA-Z0-9]{24,}$/;
const NFT_ID = /^[0-9A-Fa-f]{64}$/;

export function CreateSellOffer({ address, sign, onCreated }: Props) {
  const { addToast } = useToast();
  const [nftokenId, setNftokenId] = useState("");
  const [buyerAddress, setBuyerAddress] = useState("");
  const [errors, setErrors] = useState<{ nft?: string; buyer?: string }>({});
  const [loading, setLoading] = useState(false);
  const [txStep, setTxStep] = useState(-1);
  const [result, setResult] = useState<SubmitResult | null>(null);

  const validate = () => {
    const e: typeof errors = {};
    if (!NFT_ID.test(nftokenId.trim())) e.nft = "NFToken ID invalide (64 caractères hex).";
    if (!XRPL_ADDRESS.test(buyerAddress.trim())) e.buyer = "Adresse XRPL invalide (commence par r…).";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleCreate = async () => {
    if (!validate()) return;
    setLoading(true);
    setResult(null);
    setTxStep(0);
    try {
      nftLog.info("preparing sell offer", { nftokenId: nftokenId.trim(), destination: buyerAddress.trim() });
      const tx = await nftApi.prepareTransferOffer({
        account: address,
        nftokenId: nftokenId.trim().toUpperCase(),
        destination: buyerAddress.trim(),
        amount: "0",
      });
      setTxStep(1);
      const txBlob = await sign(tx);
      setTxStep(2);
      const res = await nftApi.submit(txBlob);
      nftLog.info("sell offer created", res);
      setResult(res);
      addToast("Offre de vente créée — partagez l'Offer ID avec l'acheteur.", "success");
      onCreated?.();
    } catch (err) {
      nftLog.error("sell offer failed", { err });
      addToast(translateXrplError(err), "error");
      setTxStep(-1);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setResult(null);
    setTxStep(-1);
    setNftokenId("");
    setBuyerAddress("");
    setErrors({});
  };

  return (
    <section className="form-card">
      <h2>Créer une Offre de Vente NFT</h2>
      <p className="info" style={{ fontSize: "0.85rem", lineHeight: 1.7 }}>
        Crée un <strong>NFTokenCreateOffer</strong> ciblé sur l'adresse de l'acheteur.
        L'acheteur pourra l'accepter pour finaliser le transfert du titre.
      </p>

      {!result ? (
        <>
          <label>
            NFToken ID
            <input
              type="text"
              placeholder="64 caractères hex — ID du titre de propriété"
              value={nftokenId}
              onChange={(e) => { setNftokenId(e.target.value); setErrors((x) => ({ ...x, nft: "" })); }}
              disabled={loading}
              style={{ fontFamily: "monospace", fontSize: "0.8rem" }}
            />
            {errors.nft && <span className="field-error">{errors.nft}</span>}
          </label>

          <label>
            Adresse de l'acheteur
            <input
              type="text"
              placeholder="rBuyer… — adresse XRPL de l'acheteur"
              value={buyerAddress}
              onChange={(e) => { setBuyerAddress(e.target.value); setErrors((x) => ({ ...x, buyer: "" })); }}
              disabled={loading}
              style={{ fontFamily: "monospace", fontSize: "0.8rem" }}
            />
            {errors.buyer && <span className="field-error">{errors.buyer}</span>}
          </label>

          {txStep >= 0 && <Stepper steps={TX_STEPS} current={txStep} />}

          <button onClick={handleCreate} disabled={loading || !nftokenId.trim() || !buyerAddress.trim()}>
            {loading ? "Création en cours…" : "Signer & Créer l'Offre"}
          </button>
        </>
      ) : (
        <div className="result">
          <p style={{ color: "#4a7a50", fontFamily: "system-ui", fontSize: "0.85rem", fontWeight: 600 }}>
            ✓ Offre de vente créée — à partager avec l'acheteur
          </p>
          <p><strong>Offer ID</strong><br /><Copyable text={result.offerId ?? ""} truncate={12} /></p>
          <p>
            <strong>Offer Sequence</strong>
            {result.sequence !== undefined
              ? <><br /><Copyable text={String(result.sequence)} /></>
              : <span style={{ color: "#c0392b", fontSize: "0.8rem" }}> — non détecté, vérifiez sur XRPL Explorer</span>
            }
          </p>
          <p><strong>Tx Hash</strong><br /><Copyable text={result.txHash} truncate={12} /></p>
          <button
            className="btn-secondary"
            onClick={handleReset}
            style={{ marginTop: "0.5rem" }}
          >
            Nouvelle offre
          </button>
        </div>
      )}
    </section>
  );
}
