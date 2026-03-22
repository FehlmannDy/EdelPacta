import { useState, useEffect } from "react";
import { escrowApi, CreateEscrowResult } from "../api/escrow";
import { nftApi, NFTOffer } from "../api/nft";
import { escrowLog } from "../logger";
import { Stepper } from "@shared/components/Stepper";
import { Copyable } from "@shared/components/Copyable";
import { useToast } from "@shared/context/ToastContext";

interface Props {
  escrow: CreateEscrowResult & { nftId: string };
  buyerAddress: string;
  sign: (tx: Record<string, unknown>) => Promise<string>;
  onDone: () => void;
}

const STEPS = ["Signer le transfert NFT", "Soumettre le transfert", "Finaliser l'escrow"];

export function SettleAndAccept({ escrow, buyerAddress, sign, onDone }: Props) {
  const { addToast } = useToast();
  const [offers, setOffers] = useState<NFTOffer[]>([]);
  const [loadingOffers, setLoadingOffers] = useState(false);
  const [offersError, setOffersError] = useState<string | null>(null);
  const [settling, setSettling] = useState(false);
  const [txStep, setTxStep] = useState(-1);
  const [txHash, setTxHash] = useState<string | null>(null);

  const loadOffers = async () => {
    setLoadingOffers(true);
    setOffersError(null);
    try {
      const result = await nftApi.incomingOffersForNft(buyerAddress, escrow.nftId);
      setOffers(result);
    } catch (err) {
      setOffersError(err instanceof Error ? err.message : "Impossible de charger les offres");
    } finally {
      setLoadingOffers(false);
    }
  };

  useEffect(() => { loadOffers(); }, [buyerAddress, escrow.nftId]);

  const handleSettle = async (offer: NFTOffer) => {
    setSettling(true);
    setTxStep(0);
    setTxHash(null);
    try {
      // Step 1 — Signer l'acceptation de l'offre NFT (le NFT doit être dans le wallet avant EscrowFinish)
      escrowLog.info("preparing NFT accept offer", { offerId: offer.offerId });
      const tx = await nftApi.prepareAcceptOffer({ account: buyerAddress, offerId: offer.offerId });
      const txBlob = await sign(tx);

      // Step 2 — Soumettre le transfert NFT
      setTxStep(1);
      escrowLog.info("submitting NFT accept offer");
      await nftApi.submit(txBlob);

      // Step 3 — EscrowFinish (le WASM vérifie que l'acheteur possède le NFT)
      setTxStep(2);
      escrowLog.info("finishing escrow", {
        escrowSequence: escrow.escrowSequence,
        nftId: escrow.nftId,
        buyerAddress,
      });
      await escrowApi.finish({
        escrowSequence: escrow.escrowSequence,
        nftId: escrow.nftId,
        buyerAddress,
      });

      setTxHash("done");
      addToast("Règlement complet — le titre de propriété est dans votre wallet.", "success");
      onDone();
    } catch (err) {
      escrowLog.error("settle and accept failed", { err });
      addToast(err instanceof Error ? err.message : "Échec du règlement", "error");
      setTxStep(-1);
    } finally {
      setSettling(false);
    }
  };

  return (
    <section className="form-card">
      <h2>Régler & Recevoir le Titre</h2>
      <p className="info" style={{ fontSize: "0.85rem", lineHeight: 1.7 }}>
        Une fois que le vendeur a créé une offre de vente pour votre adresse, elle apparaît
        ci-dessous. Cliquez sur <strong>Régler & Accepter</strong> pour libérer les fonds
        au vendeur et recevoir le titre de propriété en une seule étape.
      </p>

      <div className="result" style={{ marginBottom: "0.75rem" }}>
        <p><strong>Compte escrow</strong><br /><Copyable text={escrow.escrowAccount} truncate={10} /></p>
        <p><strong>NFT ID</strong><br /><Copyable text={escrow.nftId} truncate={10} /></p>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
        <strong style={{ fontSize: "0.85rem" }}>Offres de vente entrantes</strong>
        <button
          onClick={loadOffers}
          disabled={loadingOffers || settling}
          className="btn-secondary"
          style={{ fontSize: "0.75rem", padding: "0.25rem 0.6rem" }}
        >
          {loadingOffers ? "…" : "Actualiser"}
        </button>
      </div>

      {loadingOffers && (
        <p style={{ fontSize: "0.85rem", color: "#8a7a68" }}>Recherche des offres…</p>
      )}
      {!loadingOffers && offersError && <p className="error">{offersError}</p>}
      {!loadingOffers && !offersError && offers.length === 0 && (
        <p style={{ fontSize: "0.85rem", color: "#8a7a68", fontStyle: "italic" }}>
          Aucune offre trouvée. Demandez au vendeur de créer une offre pour votre adresse,
          puis actualisez.
        </p>
      )}

      {offers.map((offer) => (
        <div key={offer.offerId} className="result">
          <p><strong>NFToken ID</strong><br /><Copyable text={offer.nftokenId} truncate={10} /></p>
          <p><strong>Vendeur</strong><br /><Copyable text={offer.owner} truncate={10} /></p>
          <p><strong>Offer ID</strong><br /><Copyable text={offer.offerId} truncate={10} /></p>

          {txStep >= 0 && <Stepper steps={STEPS} current={txStep} />}

          {txHash ? (
            <p style={{ color: "#4a7a50", fontFamily: "system-ui", fontSize: "0.85rem", fontWeight: 600 }}>
              ✓ Titre de propriété reçu dans votre wallet.
            </p>
          ) : (
            <button onClick={() => handleSettle(offer)} disabled={settling || loadingOffers}>
              {settling ? "Traitement en cours…" : "Régler & Accepter le Titre"}
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
