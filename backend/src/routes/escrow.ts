import { Router, Request, Response } from "express";
import logger from "../logger";
import {
  getBuyerInfo,
  createEscrow,
  finishEscrow,
  acceptNft,
  getPendingEscrows,
  getAccountNFTs,
} from "../services/escrowService";

const router = Router();

/**
 * POST /api/escrow/buyer-info
 * Derives the buyer's XRPL address and returns their XRP balance.
 * Body: { seed }
 * Response: { address, balance }
 */
router.post("/buyer-info", async (req: Request, res: Response): Promise<void> => {
  const { seed } = req.body as { seed?: unknown };
  if (!seed || typeof seed !== "string") {
    res.status(400).json({ error: "Missing required field: seed" });
    return;
  }
  try {
    const info = await getBuyerInfo(seed);
    res.json(info);
  } catch (err) {
    logger.error({ err }, "escrow: get buyer info failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/**
 * POST /api/escrow/create
 * Creates an EscrowCreate transaction signed with the buyer's seed.
 * Embeds the WASM FinishFunction that enforces 6 on-chain checks.
 *
 * Body: { buyerSeed, sellerAddress, nftId, amountXrp }
 * Response: { escrowSequence, hash, buyerAddress, cancelAfter }
 */
router.post("/create", async (req: Request, res: Response): Promise<void> => {
  const { buyerSeed, sellerAddress, nftId, amountRlusd } = req.body as {
    buyerSeed?: unknown;
    sellerAddress?: unknown;
    nftId?: unknown;
    amountRlusd?: unknown;
  };

  if (!buyerSeed || typeof buyerSeed !== "string") {
    res.status(400).json({ error: "Missing required field: buyerSeed" });
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
    logger.info({ sellerAddress, nftId, amountRlusd }, "escrow: create request");
    const result = await createEscrow({ buyerSeed, sellerAddress, nftId, amountRlusd });
    res.json(result);
  } catch (err) {
    logger.error({ err }, "escrow: create failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/**
 * POST /api/escrow/finish
 * Submits EscrowFinish with 6 memos (uses ISSUER_SEED for notaire + ORACLE_SEED for oracle).
 * The WASM verifies: notaire identity, KYC, NFT ownership, dual signatures, NFT offer active.
 *
 * Body: { buyerAddress, escrowSequence, nftId, offerSequence }
 * Response: { hash }
 */
router.post("/finish", async (req: Request, res: Response): Promise<void> => {
  const { buyerAddress, escrowSequence, nftId, offerSequence } = req.body as {
    buyerAddress?: unknown;
    escrowSequence?: unknown;
    nftId?: unknown;
    offerSequence?: unknown;
  };

  if (!buyerAddress || typeof buyerAddress !== "string") {
    res.status(400).json({ error: "Missing required field: buyerAddress" });
    return;
  }
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
    logger.info({ buyerAddress, escrowSequence, nftId, offerSequence }, "escrow: finish request");
    const result = await finishEscrow({ buyerAddress, escrowSequence, nftId, offerSequence });
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
