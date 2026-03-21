import { Router, Request, Response } from "express";
import logger from "../logger";
import {
  mintNFT,
  NFTokenMintFlags,
  createTransferOffer,
  acceptTransferOffer,
  prepareMintTx,
  prepareBurnTx,
  prepareTransferOfferTx,
  prepareAcceptOfferTx,
  submitSignedTx,
  getAccountNFTs,
  getIncomingOffers,
  getIncomingOffersForAccount,
  getOutgoingOffers,
} from "../services/xrplService";

const router = Router();

/**
 * POST /api/nft/mint
 *
 * Mint an XLS-20 NFT on the XRPL.
 *
 * Body (JSON):
 *   seed        {string}  required — wallet family seed (e.g. "sEd...")
 *   taxon       {number}  required — NFT taxon (uint32 grouping identifier)
 *   uri         {string}  optional — metadata URI (e.g. IPFS link), max 256 bytes
 *   transferFee {number}  optional — basis points 0–50000 (default 0)
 *   flags       {number}  optional — NFTokenMint flags bitmask (default: tfTransferable)
 *   networkUrl  {string}  optional — XRPL WebSocket URL (default: testnet)
 *
 * Response 200:
 *   { nftokenId, txHash, account }
 *
 * Response 400: missing/invalid parameters
 * Response 500: XRPL or internal error
 */
router.post("/mint", async (req: Request, res: Response): Promise<void> => {
  const { seed, taxon, uri, transferFee, flags, networkUrl } = req.body;

  if (!seed || typeof seed !== "string") {
    res.status(400).json({ error: "Missing required field: seed" });
    return;
  }

  if (taxon === undefined || taxon === null || typeof taxon !== "number" || !Number.isInteger(taxon) || taxon < 0) {
    res.status(400).json({ error: "Missing or invalid field: taxon (must be a non-negative integer)" });
    return;
  }

  if (transferFee !== undefined && (typeof transferFee !== "number" || transferFee < 0 || transferFee > 50000)) {
    res.status(400).json({ error: "Invalid field: transferFee must be between 0 and 50000" });
    return;
  }

  if (uri !== undefined && typeof uri !== "string") {
    res.status(400).json({ error: "Invalid field: uri must be a string" });
    return;
  }

  if (uri && Buffer.byteLength(uri, "utf8") > 256) {
    res.status(400).json({ error: "Invalid field: uri must be 256 bytes or less" });
    return;
  }

  try {
    logger.info({ taxon, uri, flags }, "nft: minting");
    const result = await mintNFT({ seed, taxon, uri, transferFee, flags, networkUrl });
    logger.info({ account: result.account, nftokenId: result.nftokenId, txHash: result.txHash }, "nft: minted");
    res.status(200).json(result);
  } catch (err) {
    logger.error({ err }, "nft: mint failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/**
 * POST /api/nft/transfer/offer
 *
 * Step 1 of a transfer: the current owner creates a sell offer for 0 XRP.
 *
 * Body (JSON):
 *   seed        {string}  required — owner's wallet seed
 *   nftokenId   {string}  required — NFTokenID to transfer
 *   destination {string}  optional — recipient address (restricts who can accept)
 *   amount      {string}  optional — XRP drops, default "0" (free transfer)
 *   networkUrl  {string}  optional
 *
 * Response 200:
 *   { offerId, txHash }
 */
router.post("/transfer/offer", async (req: Request, res: Response): Promise<void> => {
  const { seed, nftokenId, destination, amount, networkUrl } = req.body;

  if (!seed || typeof seed !== "string") {
    res.status(400).json({ error: "Missing required field: seed" });
    return;
  }

  if (!nftokenId || typeof nftokenId !== "string") {
    res.status(400).json({ error: "Missing required field: nftokenId" });
    return;
  }

  try {
    logger.info({ nftokenId, destination }, "nft: creating transfer offer");
    const result = await createTransferOffer({ seed, nftokenId, destination, amount, networkUrl });
    logger.info({ nftokenId, offerId: result.offerId, txHash: result.txHash }, "nft: transfer offer created");
    res.status(200).json(result);
  } catch (err) {
    logger.error({ nftokenId, err }, "nft: transfer offer creation failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/**
 * POST /api/nft/transfer/accept
 *
 * Step 2 of a transfer: the recipient accepts the sell offer.
 *
 * Body (JSON):
 *   seed       {string}  required — recipient's wallet seed
 *   offerId    {string}  required — offer ID from /transfer/offer
 *   networkUrl {string}  optional
 *
 * Response 200:
 *   { txHash, account }
 */
router.post("/transfer/accept", async (req: Request, res: Response): Promise<void> => {
  const { seed, offerId, networkUrl } = req.body;

  if (!seed || typeof seed !== "string") {
    res.status(400).json({ error: "Missing required field: seed" });
    return;
  }

  if (!offerId || typeof offerId !== "string") {
    res.status(400).json({ error: "Missing required field: offerId" });
    return;
  }

  try {
    logger.info({ offerId }, "nft: accepting transfer offer");
    const result = await acceptTransferOffer({ seed, offerId, networkUrl });
    logger.info({ offerId, txHash: result.txHash, account: result.account }, "nft: transfer offer accepted");
    res.status(200).json(result);
  } catch (err) {
    logger.error({ offerId, err }, "nft: accept transfer offer failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ---------------------------------------------------------------------------
// Prepare + Submit endpoints (for frontend wallet signing via Otsu/GemWallet)
// ---------------------------------------------------------------------------

/**
 * POST /api/nft/prepare/mint
 * Returns an unsigned, autofilled NFTokenMint transaction for the wallet to sign.
 * Body: { account, taxon, uri?, transferFee?, flags?, networkUrl? }
 */
router.post("/prepare/mint", async (req: Request, res: Response): Promise<void> => {
  const { account, taxon, uri, transferFee, flags, networkUrl } = req.body;

  if (!account || typeof account !== "string") {
    res.status(400).json({ error: "Missing required field: account" });
    return;
  }
  if (taxon === undefined || typeof taxon !== "number" || !Number.isInteger(taxon) || taxon < 0) {
    res.status(400).json({ error: "Missing or invalid field: taxon" });
    return;
  }

  try {
    logger.info({ account, taxon, uri, flags }, "nft: preparing mint tx");
    const tx = await prepareMintTx({ account, taxon, uri, transferFee, flags, networkUrl });
    logger.info({ account, taxon }, "nft: mint tx prepared");
    res.json(tx);
  } catch (err) {
    logger.error({ account, err }, "nft: prepare mint tx failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/**
 * POST /api/nft/prepare/burn
 * Returns an unsigned NFTokenBurn transaction.
 * Body: { account, nftokenId, networkUrl? }
 */
router.post("/prepare/burn", async (req: Request, res: Response): Promise<void> => {
  const { account, nftokenId, networkUrl } = req.body;

  if (!account || typeof account !== "string") {
    res.status(400).json({ error: "Missing required field: account" });
    return;
  }
  if (!nftokenId || typeof nftokenId !== "string") {
    res.status(400).json({ error: "Missing required field: nftokenId" });
    return;
  }

  try {
    logger.info({ account, nftokenId }, "nft: preparing burn tx");
    const tx = await prepareBurnTx({ account, nftokenId, networkUrl });
    logger.info({ account, nftokenId }, "nft: burn tx prepared");
    res.json(tx);
  } catch (err) {
    logger.error({ account, nftokenId, err }, "nft: prepare burn tx failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/**
 * POST /api/nft/prepare/transfer-offer
 * Returns an unsigned NFTokenCreateOffer transaction.
 * Body: { account, nftokenId, destination?, amount?, networkUrl? }
 */
router.post("/prepare/transfer-offer", async (req: Request, res: Response): Promise<void> => {
  const { account, nftokenId, destination, amount, networkUrl } = req.body;

  if (!account || typeof account !== "string") {
    res.status(400).json({ error: "Missing required field: account" });
    return;
  }
  if (!nftokenId || typeof nftokenId !== "string") {
    res.status(400).json({ error: "Missing required field: nftokenId" });
    return;
  }

  try {
    logger.info({ account, nftokenId, destination }, "nft: preparing transfer offer tx");
    const tx = await prepareTransferOfferTx({ account, nftokenId, destination, amount, networkUrl });
    logger.info({ account, nftokenId }, "nft: transfer offer tx prepared");
    res.json(tx);
  } catch (err) {
    logger.error({ account, nftokenId, err }, "nft: prepare transfer offer tx failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/**
 * POST /api/nft/prepare/accept-offer
 * Returns an unsigned NFTokenAcceptOffer transaction.
 * Body: { account, offerId, networkUrl? }
 */
router.post("/prepare/accept-offer", async (req: Request, res: Response): Promise<void> => {
  const { account, offerId, networkUrl } = req.body;

  if (!account || typeof account !== "string") {
    res.status(400).json({ error: "Missing required field: account" });
    return;
  }
  if (!offerId || typeof offerId !== "string") {
    res.status(400).json({ error: "Missing required field: offerId" });
    return;
  }

  try {
    logger.info({ account, offerId }, "nft: preparing accept offer tx");
    const tx = await prepareAcceptOfferTx({ account, offerId, networkUrl });
    logger.info({ account, offerId }, "nft: accept offer tx prepared");
    res.json(tx);
  } catch (err) {
    logger.error({ account, offerId, err }, "nft: prepare accept offer tx failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/**
 * POST /api/nft/submit
 * Submits a signed transaction blob to the XRPL.
 * Body: { txBlob, networkUrl? }
 * Response: { txHash, result, nftokenId?, offerId? }
 */
router.post("/submit", async (req: Request, res: Response): Promise<void> => {
  const { txBlob, networkUrl } = req.body;

  if (!txBlob || typeof txBlob !== "string") {
    res.status(400).json({ error: "Missing required field: txBlob" });
    return;
  }

  try {
    logger.info("nft: submitting signed tx");
    const result = await submitSignedTx({ txBlob, networkUrl });
    logger.info({ txHash: result.txHash, result: result.result }, "nft: signed tx submitted");
    res.json(result);
  } catch (err) {
    logger.error({ err }, "nft: submit signed tx failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/**
 * GET /api/nft/offers/incoming/:address/:nftokenId
 * Returns sell offers for a given NFToken targeted at the given address (or open offers).
 */
router.get("/offers/incoming/:address/:nftokenId", async (req: Request, res: Response): Promise<void> => {
  const { address, nftokenId } = req.params;
  const networkUrl = req.query["networkUrl"] as string | undefined;

  try {
    logger.info({ address, nftokenId }, "nft: fetching incoming offers");
    const offers = await getIncomingOffers(address, nftokenId, networkUrl);
    logger.info({ address, nftokenId, count: offers.length }, "nft: incoming offers fetched");
    res.json({ offers });
  } catch (err) {
    logger.error({ address, nftokenId, err }, "nft: fetch incoming offers failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/**
 * GET /api/nft/offers/incoming-for-account/:address
 * Returns all pending sell offers where Destination === address (offers sent to this wallet).
 */
router.get("/offers/incoming-for-account/:address", async (req: Request, res: Response): Promise<void> => {
  const { address } = req.params;
  const networkUrl = req.query["networkUrl"] as string | undefined;

  const minterAddress = process.env.ISSUER_ADDRESS;
  if (!minterAddress) {
    res.status(500).json({ error: "ISSUER_ADDRESS not configured on server" });
    return;
  }

  try {
    logger.info({ address, minterAddress }, "nft: fetching incoming offers for account");
    const offers = await getIncomingOffersForAccount(address, minterAddress, networkUrl);
    logger.info({ address, count: offers.length }, "nft: incoming offers for account fetched");
    res.json({ offers });
  } catch (err) {
    logger.error({ address, err }, "nft: fetch incoming offers for account failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/**
 * GET /api/nft/list/:address
 * Returns all NFTs owned by the given XRPL address.
 */
router.get("/list/:address", async (req: Request, res: Response): Promise<void> => {
  const { address } = req.params;
  const networkUrl = req.query["networkUrl"] as string | undefined;

  try {
    logger.info({ address }, "nft: listing account NFTs");
    const nfts = await getAccountNFTs(address, networkUrl);
    logger.info({ address, count: nfts.length }, "nft: account NFTs fetched");
    res.json({ account: address, nfts, count: nfts.length });
  } catch (err) {
    logger.error({ address, err }, "nft: list account NFTs failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/**
 * GET /api/nft/offers/outgoing/:address
 * Returns all pending NFT offers created by the given address.
 */
router.get("/offers/outgoing/:address", async (req: Request, res: Response): Promise<void> => {
  const { address } = req.params;
  const networkUrl = req.query["networkUrl"] as string | undefined;

  try {
    logger.info({ address }, "nft: fetching outgoing offers");
    const offers = await getOutgoingOffers(address, networkUrl);
    logger.info({ address, count: offers.length }, "nft: outgoing offers fetched");
    res.json({ offers });
  } catch (err) {
    logger.error({ address, err }, "nft: fetch outgoing offers failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/**
 * GET /api/nft/flags
 *
 * Returns the available NFTokenMint flag values for reference.
 */
router.get("/flags", (_req: Request, res: Response): void => {
  res.json(NFTokenMintFlags);
});

export default router;
