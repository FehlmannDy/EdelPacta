import { Router, Request, Response } from "express";
import logger from "../logger";
import {
  getAddressInfo,
  preparePayment,
  createEscrow,
  finishEscrow,
  acceptNft,
  getPendingEscrows,
  getAccountNFTs,
} from "../services/escrowService";

const router = Router();

/**
 * GET /api/escrow/address-info/:address
 * Returns XRP balance for a given XRPL address.
 */
router.get("/address-info/:address", async (req: Request, res: Response): Promise<void> => {
  const { address } = req.params;
  try {
    const info = await getAddressInfo(address);
    res.json(info);
  } catch (err) {
    logger.error({ err }, "escrow: get address info failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/**
 * POST /api/escrow/prepare-payment
 * Returns an unsigned Payment tx for the buyer to sign with their Otsu wallet.
 * Body: { buyerAddress, amountRlusd }
 * Response: { tx }
 */
router.post("/prepare-payment", async (req: Request, res: Response): Promise<void> => {
  const { buyerAddress, amountRlusd } = req.body as { buyerAddress?: unknown; amountRlusd?: unknown };
  if (!buyerAddress || typeof buyerAddress !== "string") {
    res.status(400).json({ error: "Missing required field: buyerAddress" });
    return;
  }
  if (typeof amountRlusd !== "number" || amountRlusd <= 0) {
    res.status(400).json({ error: "Missing or invalid field: amountRlusd" });
    return;
  }
  try {
    const tx = await preparePayment(buyerAddress, amountRlusd);
    res.json({ tx });
  } catch (err) {
    logger.error({ err }, "escrow: prepare payment failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/**
 * POST /api/escrow/create
 * Submits the buyer's signed Payment, then creates EscrowCreate from the issuer account.
 * The WASM FinishFunction is embedded and backend-signed — no buyer seed required.
 *
 * Body: { paymentTxBlob, buyerAddress, sellerAddress, nftId, amountRlusd }
 * Response: { escrowSequence, hash, escrowAccount, buyerAddress, cancelAfter }
 */
router.post("/create", async (req: Request, res: Response): Promise<void> => {
  const { paymentTxBlob, buyerAddress, sellerAddress, nftId, amountRlusd } = req.body as {
    paymentTxBlob?: unknown;
    buyerAddress?: unknown;
    sellerAddress?: unknown;
    nftId?: unknown;
    amountRlusd?: unknown;
  };

  if (!paymentTxBlob || typeof paymentTxBlob !== "string") {
    res.status(400).json({ error: "Missing required field: paymentTxBlob" });
    return;
  }
  if (!buyerAddress || typeof buyerAddress !== "string") {
    res.status(400).json({ error: "Missing required field: buyerAddress" });
    return;
  }
  if (!sellerAddress || typeof sellerAddress !== "string") {
    res.status(400).json({ error: "Missing required field: sellerAddress" });
    return;
  }
  if (!nftId || typeof nftId !== "string") {
    res.status(400).json({ error: "Missing required field: nftId" });
    return;
  }
  if (typeof amountRlusd !== "number" || amountRlusd <= 0) {
    res.status(400).json({ error: "Missing or invalid field: amountRlusd (must be a positive number)" });
    return;
  }

  try {
    logger.info({ buyerAddress, sellerAddress, nftId, amountRlusd }, "escrow: create request");
    const result = await createEscrow({ paymentTxBlob, buyerAddress, sellerAddress, nftId, amountRlusd });
    res.json(result);
  } catch (err) {
    logger.error({ err }, "escrow: create failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/**
 * POST /api/escrow/finish
 * Submits EscrowFinish with 6 memos (uses ORACLE_SEED for all backend operations).
 * The WASM verifies: notaire identity, KYC, NFT ownership, dual signatures, NFT offer active.
 *
 * Body: { buyerAddress, escrowSequence, nftId, offerSequence }
 * Response: { hash }
 */
router.post("/finish", async (req: Request, res: Response): Promise<void> => {
  const { escrowSequence, nftId, offerSequence } = req.body as {
    escrowSequence?: unknown;
    nftId?: unknown;
    offerSequence?: unknown;
  };

  if (typeof escrowSequence !== "number") {
    res.status(400).json({ error: "Missing or invalid field: escrowSequence (must be a number)" });
    return;
  }
  if (!nftId || typeof nftId !== "string") {
    res.status(400).json({ error: "Missing required field: nftId" });
    return;
  }
  if (typeof offerSequence !== "number") {
    res.status(400).json({ error: "Missing or invalid field: offerSequence (must be a number)" });
    return;
  }

  try {
    logger.info({ escrowSequence, nftId, offerSequence }, "escrow: finish request");
    const result = await finishEscrow({ escrowSequence, nftId, offerSequence });
    res.json(result);
  } catch (err) {
    logger.error({ err }, "escrow: finish failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/**
 * POST /api/escrow/accept-nft
 * Submits NFTokenAcceptOffer signed with the buyer's seed.
 * Call this after EscrowFinish succeeds to transfer the property title NFT to the buyer.
 *
 * Body: { buyerSeed, offerId }
 * Response: { txHash, account }
 */
router.post("/accept-nft", async (req: Request, res: Response): Promise<void> => {
  const { buyerSeed, offerId } = req.body as { buyerSeed?: unknown; offerId?: unknown };

  if (!buyerSeed || typeof buyerSeed !== "string") {
    res.status(400).json({ error: "Missing required field: buyerSeed" });
    return;
  }
  if (!offerId || typeof offerId !== "string") {
    res.status(400).json({ error: "Missing required field: offerId" });
    return;
  }

  try {
    logger.info({ offerId }, "escrow: accept NFT request");
    const result = await acceptNft({ buyerSeed, offerId });
    res.json(result);
  } catch (err) {
    logger.error({ err }, "escrow: accept NFT failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/**
 * GET /api/escrow/pending/:address
 * Returns pending escrow objects on-chain for the given address.
 */
router.get("/pending/:address", async (req: Request, res: Response): Promise<void> => {
  const { address } = req.params;
  try {
    const escrows = await getPendingEscrows(address);
    res.json({ escrows });
  } catch (err) {
    logger.error({ address, err }, "escrow: get pending failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/**
 * GET /api/escrow/nfts/:address
 * Returns NFTs held by the given address (property titles received).
 */
router.get("/nfts/:address", async (req: Request, res: Response): Promise<void> => {
  const { address } = req.params;
  try {
    const nfts = await getAccountNFTs(address);
    res.json({ nfts });
  } catch (err) {
    logger.error({ address, err }, "escrow: get NFTs failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

export default router;
