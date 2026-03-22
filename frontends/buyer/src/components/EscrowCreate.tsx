import { useState } from "react";
import { escrowApi, CreateEscrowResult } from "../api/escrow";
import { escrowLog } from "../logger";
import { Stepper } from "./Stepper";
import { Copyable } from "./Copyable";
import { useToast } from "../context/ToastContext";

interface Props {
  buyerAddress: string;
  sign: (tx: Record<string, unknown>) => Promise<string>;
  onCreated: (result: CreateEscrowResult & { nftId: string; amountRlusd: number }) => void;
}

const STEPS = ["Préparer le paiement", "Signer avec Otsu", "Créer l'escrow"];

export function EscrowCreate({ buyerAddress, sign, onCreated }: Props) {
  const { addToast } = useToast();
  const [sellerAddress, setSellerAddress] = useState("");
  const [nftId, setNftId] = useState("");
  const [amountRlusd, setAmountRlusd] = useState("");
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(-1);
  const [result, setResult] = useState<(CreateEscrowResult & { nftId: string; amountRlusd: number }) | null>(null);
  const [errors, setErrors] = useState<{ seller?: string; nft?: string; amount?: string }>({});

  function validate() {
    const e: typeof errors = {};
    if (!sellerAddress.trim() || !/^r[a-zA-Z0-9]{24,}$/.test(sellerAddress.trim()))
      e.seller = "Adresse XRPL valide requise (commence par r…)";
    if (!nftId.trim() || !/^[0-9A-Fa-f]{64}$/.test(nftId.trim()))
      e.nft = "L'ID NFT doit être une chaîne hexadécimale de 64 caractères";
    const amt = parseFloat(amountRlusd);
    if (isNaN(amt) || amt <= 0)
      e.amount = "Le montant doit être un nombre positif";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  const handleCreate = async () => {
    if (!validate()) return;
    setLoading(true);
    setStep(0);
    setResult(null);
    try {
      const amt = parseFloat(amountRlusd);

      // Step 1 — backend prepares an unsigned Payment
      escrowLog.info("preparing payment tx", { buyerAddress, amountRlusd });
      const { tx } = await escrowApi.preparePayment({ buyerAddress, amountRlusd: amt });

      // Step 2 — buyer signs with Otsu (standard Payment, no custom fields)
      setStep(1);
      escrowLog.info("signing payment with Otsu");
      const paymentTxBlob = await sign(tx);

      // Step 3 — backend submits payment + creates EscrowCreate with WASM
      setStep(2);
      escrowLog.info("creating escrow", { sellerAddress, nftId });
      const res = await escrowApi.create({
        paymentTxBlob,
        buyerAddress,
        sellerAddress: sellerAddress.trim(),
        nftId: nftId.trim().toUpperCase(),
        amountRlusd: amt,
      });

      escrowLog.info("escrow created", res);
      const full = { ...res, nftId: nftId.trim().toUpperCase(), amountRlusd: amt };
      setResult(full);
      onCreated(full);
      addToast(`Escrow créé — ${amountRlusd} RLUSD verrouillés on-chain.`, "success");
    } catch (err) {
      escrowLog.error("create failed", { err });
      addToast(err instanceof Error ? err.message : "Création de l'escrow échouée", "error");
      setStep(-1);
    } finally {
      setLoading(false);
    }
  };

  if (result) {
    return (
      <section className="form-card">
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.25rem" }}>
          <span style={{ fontSize: "1.4rem" }}>🔒</span>
          <h2 style={{ margin: 0 }}>Escrow Créé</h2>
        </div>

        <div style={{
          background: "rgba(74,122,80,0.07)",
          border: "1px solid rgba(74,122,80,0.25)",
          borderRadius: "8px",
          padding: "0.9rem 1rem",
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          margin: "0.25rem 0 0.5rem",
        }}>
          <span style={{ fontSize: "1.6rem" }}>✅</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: "1rem", color: "#3a6b40" }}>
              {result.amountRlusd.toLocaleString()} RLUSD verrouillés
            </div>
            <div style={{ fontSize: "0.78rem", color: "#5a7a60", marginTop: "0.15rem" }}>
              Séquence escrow #{result.escrowSequence}
            </div>
          </div>
        </div>

        <div className="result" style={{ gap: "0.5rem" }}>
          <p style={{ margin: 0 }}>
            <strong style={{ fontSize: "0.72rem", letterSpacing: "0.06em", textTransform: "uppercase", color: "#8a7060" }}>
              Compte escrow
            </strong>
            <br />
            <Copyable text={result.escrowAccount} truncate={12} />
          </p>
          <p style={{ margin: 0 }}>
            <strong style={{ fontSize: "0.72rem", letterSpacing: "0.06em", textTransform: "uppercase", color: "#8a7060" }}>
              NFT ID
            </strong>
            <br />
            <Copyable text={result.nftId} truncate={12} />
          </p>
          <p style={{ margin: 0 }}>
            <strong style={{ fontSize: "0.72rem", letterSpacing: "0.06em", textTransform: "uppercase", color: "#8a7060" }}>
              Hash transaction
            </strong>
            <br />
            <Copyable text={result.hash} truncate={12} />
          </p>
        </div>

        <p className="info" style={{ fontSize: "0.82rem", lineHeight: 1.7, marginTop: "0.5rem" }}>
          Les RLUSD sont verrouillés dans l'escrow WASM. Le notaire va maintenant vérifier
          les 6 conditions (KYC, propriété NFT, double signature) et libérer les fonds.
        </p>
      </section>
    );
  }

  return (
    <section className="form-card">
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.25rem" }}>
        <span style={{ fontSize: "1.4rem" }}>🏠</span>
        <h2 style={{ margin: 0 }}>Créer un Smart Escrow</h2>
      </div>

      <p className="info" style={{ fontSize: "0.85rem", lineHeight: 1.7, marginTop: "0.25rem" }}>
        Verrouillez des RLUSD dans un escrow sécurisé par contrat WASM. Votre wallet Otsu
        signera uniquement un paiement standard — aucune seed requise.
      </p>

      <label>
        Adresse du Vendeur
        <input
          type="text"
          placeholder="rXXX… — adresse XRPL du vendeur"
          value={sellerAddress}
          onChange={(e) => setSellerAddress(e.target.value)}
          disabled={loading}
        />
        {errors.seller && <span className="field-error">{errors.seller}</span>}
      </label>

      <label>
        ID NFT (Titre de Propriété)
        <input
          type="text"
          placeholder="64 caractères hex — identifiant du titre de propriété"
          value={nftId}
          onChange={(e) => setNftId(e.target.value)}
          disabled={loading}
        />
        {errors.nft && <span className="field-error">{errors.nft}</span>}
      </label>

      <label>
        Montant (RLUSD)
        <div style={{ position: "relative" }}>
          <input
            type="number"
            placeholder="ex. 100"
            min="0.01"
            step="0.01"
            value={amountRlusd}
            onChange={(e) => setAmountRlusd(e.target.value)}
            disabled={loading}
            style={{ paddingRight: "4.5rem" }}
          />
          <span style={{
            position: "absolute", right: "0.85rem", top: "50%", transform: "translateY(-50%)",
            fontSize: "0.78rem", fontWeight: 700, color: "#8a7060", pointerEvents: "none",
            letterSpacing: "0.04em",
          }}>
            RLUSD
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
          <><span className="spinner spinner--sm spinner--inline" /> Création en cours…</>
        ) : "Verrouiller les RLUSD dans l'Escrow"}
      </button>
    </section>
  );
}
