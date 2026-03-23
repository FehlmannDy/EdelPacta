import { Copyable } from "@shared/components/Copyable";
import { SkeletonCard } from "@shared/components/SkeletonCard";
import { Stepper } from "@shared/components/Stepper";
import { useToast } from "@shared/context/ToastContext";
import { escrowLog } from "@shared/logger";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CreateEscrowResult, escrowApi } from "../api/escrow";
import { IncomingOffer, nftApi, NFTOffer } from "../api/nft";

const NFT_OWNERSHIP_WAIT_MS = 120_000;
const NFT_OWNERSHIP_POLL_MS = 3_000;
const NFT_OWNERSHIP_WAIT_SECONDS = Math.floor(NFT_OWNERSHIP_WAIT_MS / 1000);

const STEPS = [
  "Prepare NFT acceptance",
  "Sign NFT acceptance",
  "Submit NFT acceptance",
  "Confirm deed in wallet",
  "Finalize smart escrow",
];

interface Props {
  buyerAddress: string;
  sign: (tx: Record<string, unknown>) => Promise<string>;
  escrow: CreateEscrowResult & { nftId: string; amountXrp: number };
  onFinished: (finishHash: string) => void;
}

export function AcceptAndFinalizeEscrow({ buyerAddress, sign, escrow, onFinished }: Props) {
  const { addToast } = useToast();
  const [offers, setOffers] = useState<Array<IncomingOffer | NFTOffer>>([]);
  const [loadingOffers, setLoadingOffers] = useState(true);
  const [offerError, setOfferError] = useState<string | null>(null);

  const [running, setRunning] = useState(false);
  const [step, setStep] = useState(-1);
  const [stepError, setStepError] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [waitingOwnership, setWaitingOwnership] = useState(false);
  const [ownershipWaitSeconds, setOwnershipWaitSeconds] = useState(0);

  const [acceptTxHash, setAcceptTxHash] = useState<string | null>(null);
  const [finishHash, setFinishHash] = useState<string | null>(null);
  // BUYER-007+009: track whether the NFT accept tx was already submitted
  // so retry skips re-signing and goes straight to ownership wait
  const [acceptAlreadySubmitted, setAcceptAlreadySubmitted] = useState(false);

  // BUYER-008: auto-poll offers while waiting for vendor transfer
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const selectedOffer = useMemo(() => {
    const expectedNft = escrow.nftId.toUpperCase();
    return offers.find((o) => o.nftokenId.toUpperCase() === expectedNft) ?? null;
  }, [offers, escrow.nftId]);

  const loadOffers = useCallback(async (silent = false) => {
    if (!silent) setLoadingOffers(true);
    setOfferError(null);
    try {
      const incoming = await nftApi.incomingOffersForNft(buyerAddress, escrow.nftId);
      setOffers(incoming);
    } catch (err) {
      if (!silent) setOfferError(err instanceof Error ? err.message : "Failed to fetch incoming deed offers");
    } finally {
      if (!silent) setLoadingOffers(false);
    }
  }, [buyerAddress, escrow.nftId]);

  useEffect(() => {
    void loadOffers();
    // BUYER-008: auto-poll every 15s while no offer is found and not running
    pollIntervalRef.current = setInterval(() => {
      void loadOffers(true);
    }, 15_000);
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [loadOffers]);

  const waitForNftInBuyerWallet = async (nftId: string): Promise<void> => {
    const expectedId = nftId.toUpperCase();
    const start = Date.now();
    const deadline = start + NFT_OWNERSHIP_WAIT_MS;
    setWaitingOwnership(true);
    setOwnershipWaitSeconds(0);
    try {
      while (Date.now() < deadline) {
        const owned = await nftApi.list(buyerAddress);
        if (owned.some((n) => n.nftokenId.toUpperCase() === expectedId)) return;
        const elapsedSeconds = Math.floor((Date.now() - start) / 1000);
        setOwnershipWaitSeconds(Math.min(elapsedSeconds, NFT_OWNERSHIP_WAIT_SECONDS));
        await new Promise((resolve) => setTimeout(resolve, NFT_OWNERSHIP_POLL_MS));
      }
    } finally {
      setWaitingOwnership(false);
    }
    throw new Error("NFT transfer not yet confirmed in your wallet. Please retry in a few seconds.");
  };

  const runAcceptAndFinalize = async () => {
    if (running || !!finishHash) return;
    // BUYER-007: if accept was already submitted, we can retry from step 3 (ownership wait)
    // even without a selectedOffer (the offer was already consumed)
    if (!acceptAlreadySubmitted && !selectedOffer) return;

    setRunning(true);
    setError(null);
    setStepError(false);
    setFinishHash(null);
    setOwnershipWaitSeconds(0);

    try {
      let nftTokenId: string;

      if (acceptAlreadySubmitted) {
        // BUYER-007+009: skip re-signing — jump straight to ownership confirmation
        escrowLog.info("retrying from ownership wait (accept tx already submitted)");
        nftTokenId = escrow.nftId;
        setStep(3);
      } else {
        setAcceptTxHash(null);
        setStep(0);
        escrowLog.info("preparing NFT accept offer", { offerId: selectedOffer!.offerId, buyerAddress });
        const unsignedAccept = await nftApi.prepareAcceptOffer({
          account: buyerAddress,
          offerId: selectedOffer!.offerId,
        });

        setStep(1);
        const acceptBlob = await sign(unsignedAccept);

        setStep(2);
        const acceptRes = await nftApi.submit(acceptBlob);
        setAcceptTxHash(acceptRes.txHash);
        escrowLog.info("NFT accepted", { txHash: acceptRes.txHash });
        // BUYER-007: mark submitted so retry skips these steps
        setAcceptAlreadySubmitted(true);
        nftTokenId = selectedOffer!.nftokenId;
      }

      setStep(3);
      await waitForNftInBuyerWallet(nftTokenId);

      setStep(4);
      escrowLog.info("submitting EscrowFinish", { escrowSequence: escrow.escrowSequence, nftId: escrow.nftId });
      const finishRes = await escrowApi.finish({
        escrowSequence: escrow.escrowSequence,
        nftId: escrow.nftId,
        buyerAddress,
      });

      setFinishHash(finishRes.hash);
      setAcceptAlreadySubmitted(false);
      setStep(STEPS.length);
      addToast("Deed accepted and escrow finalized successfully.", "success");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Accept + finalize failed";
      setError(message);
      setStepError(true);
      addToast(message, "error");
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="form-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>Accept Deed & Finalize</h2>
        <button
          onClick={() => void loadOffers()}
          disabled={loadingOffers || running}
          className="btn-secondary"
          style={{ fontSize: "0.65rem", padding: "0.25rem 0.6rem" }}
        >
          {loadingOffers ? "…" : "Refresh"}
        </button>
      </div>

      <p className="info" style={{ fontSize: "0.85rem", lineHeight: 1.7 }}>
        This single action will accept the deed offer, wait until the NFT is confirmed in your wallet,
        then finalize the smart escrow to release funds.
      </p>

      <div className="result" style={{ marginBottom: "0.5rem" }}>
        <p><strong>Escrow Sequence</strong><br />#{escrow.escrowSequence}</p>
        <p><strong>NFT ID</strong><br /><Copyable text={escrow.nftId} truncate={10} /></p>
        {selectedOffer?.offerId && <p><strong>Offer ID</strong><br /><Copyable text={selectedOffer.offerId} truncate={10} /></p>}
      </div>

      {loadingOffers && <><SkeletonCard /><SkeletonCard /></>}
      {!loadingOffers && offerError && <p className="error">{offerError}</p>}
      {!loadingOffers && !offerError && offers.length === 0 && !acceptAlreadySubmitted && (
        <div className="empty-state">
          <span>No pending escrow found. Waiting for the vendor to initiate a deed transfer.</span>
        </div>
      )}
      {acceptAlreadySubmitted && !finishHash && (
        <p className="info" style={{ fontSize: "0.78rem", color: "#4a7a50" }}>
          ✓ Deed transfer was submitted. If ownership confirmation timed out, retry to check again — the deed transfer will not be re-submitted.
        </p>
      )}
      {!loadingOffers && !offerError && offers.length > 0 && !selectedOffer && (
        <div className="empty-state">
          <span>No incoming deed offer found for this escrow yet.</span>
          <span>Ask the vendor to transfer the deed to your wallet address, then refresh.</span>
        </div>
      )}

      {step >= 0 && <Stepper steps={STEPS} current={step} error={stepError} />}

      {running && waitingOwnership && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
          <p className="info" style={{ fontSize: "0.78rem", margin: 0 }}>
            Waiting for validated NFT ownership in your wallet... {ownershipWaitSeconds}s elapsed,
            up to {NFT_OWNERSHIP_WAIT_SECONDS}s.
          </p>
          <div style={{ width: "100%", height: "6px", background: "#efe9de", borderRadius: "999px", overflow: "hidden" }}>
            <div
              style={{
                width: `${Math.min((ownershipWaitSeconds / NFT_OWNERSHIP_WAIT_SECONDS) * 100, 100)}%`,
                height: "100%",
                background: "#4a7a50",
                transition: "width 200ms linear",
              }}
            />
          </div>
        </div>
      )}

      {acceptTxHash && (
        <p style={{ fontFamily: "system-ui", fontSize: "0.78rem", color: "#4a7a50", fontWeight: 600 }}>
          ✓ Deed accepted — Tx: <Copyable text={acceptTxHash} truncate={8} />
        </p>
      )}

      {finishHash && (
        <p style={{ fontFamily: "system-ui", fontSize: "0.78rem", color: "#4a7a50", fontWeight: 600 }}>
          ✓ Escrow finalized — Tx: <Copyable text={finishHash} truncate={8} />
        </p>
      )}

      {!finishHash ? (
        <button onClick={() => void runAcceptAndFinalize()} disabled={(!selectedOffer && !acceptAlreadySubmitted) || loadingOffers || running}>
          {running ? "Processing smart escrow…" : "Accept deed and finalize smart Escrow"}
        </button>
      ) : (
        <button onClick={() => onFinished(finishHash)}>
          Continue →
        </button>
      )}

      {!running && error && <p className="error">{error}</p>}
    </section>
  );
}
