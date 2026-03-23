import { Router, Request, Response } from "express";
import logger from "../logger";
import {
  mintNFT,
  burnNFT,
  cancelNFTOffer,
  createTransferOffer,
  prepareBurnTx,
  prepareTransferOfferTx,
  prepareAcceptOfferTx,
  prepareCancelOfferTx,
  submitSignedTx,
  getAccountNFTs,
  getIncomingOffers,
  getIncomingOffersForAccount,
  getOutgoingOffers,
  getOfferDetails,
} from "../services/xrplService";

const XRPL_ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
const NFTOKEN_ID_RE = /^[0-9A-F]{64}$/i;

function isValidXrplAddress(v: unknown): v is string {
  return typeof v === "string" && XRPL_ADDRESS_RE.test(v);
}
function isValidNftokenId(v: unknown): v is string {
  return typeof v === "string" && NFTOKEN_ID_RE.test(v);
}

const router = Router();

// ---------------------------------------------------------------------------
// Prepare + Submit endpoints (for frontend wallet signing via Otsu/GemWallet)
// ---------------------------------------------------------------------------

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
  if (!isValidXrplAddress(account)) {
    res.status(400).json({ error: "Invalid XRPL address: account" });
    return;
  }
  if (!nftokenId || typeof nftokenId !== "string") {
    res.status(400).json({ error: "Missing required field: nftokenId" });
    return;
  }
  if (!isValidNftokenId(nftokenId)) {
    res.status(400).json({ error: "Invalid nftokenId: must be a 64-char hex string" });
    return;
  }

  try {
    logger.info({ account, nftokenId }, "nft: preparing burn tx");
    const tx = await prepareBurnTx({ account, nftokenId, networkUrl });
    logger.info({ account, nftokenId }, "nft: burn tx prepared");
    res.json(tx);
  } catch (err) {
    logger.error({ account, nftokenId, err }, "nft: prepare burn tx failed");
    res.status(500).json({ error: "Internal server error" });
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
  if (!isValidXrplAddress(account)) {
    res.status(400).json({ error: "Invalid XRPL address: account" });
    return;
  }
  if (!nftokenId || typeof nftokenId !== "string") {
    res.status(400).json({ error: "Missing required field: nftokenId" });
    return;
  }
  if (!isValidNftokenId(nftokenId)) {
    res.status(400).json({ error: "Invalid nftokenId: must be a 64-char hex string" });
    return;
  }
  if (destination !== undefined && !isValidXrplAddress(destination)) {
    res.status(400).json({ error: "Invalid XRPL address: destination" });
    return;
  }

  try {
    logger.info({ account, nftokenId, destination }, "nft: preparing transfer offer tx");
    const tx = await prepareTransferOfferTx({ account, nftokenId, destination, amount, networkUrl });
    logger.info({ account, nftokenId }, "nft: transfer offer tx prepared");
    res.json(tx);
  } catch (err) {
    logger.error({ account, nftokenId, err }, "nft: prepare transfer offer tx failed");
    res.status(500).json({ error: "Internal server error" });
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
  if (!isValidXrplAddress(account)) {
    res.status(400).json({ error: "Invalid XRPL address: account" });
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
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/nft/prepare/cancel-offer
 * Returns an unsigned NFTokenCancelOffer transaction.
 * Body: { account, offerIds, networkUrl? }
 */
router.post("/prepare/cancel-offer", async (req: Request, res: Response): Promise<void> => {
  const { account, offerIds, networkUrl } = req.body;

  if (!account || typeof account !== "string") {
    res.status(400).json({ error: "Missing required field: account" });
    return;
  }
  if (!isValidXrplAddress(account)) {
    res.status(400).json({ error: "Invalid XRPL address: account" });
    return;
  }
  if (!Array.isArray(offerIds) || offerIds.length === 0 || offerIds.some((id) => typeof id !== "string")) {
    res.status(400).json({ error: "Missing or invalid field: offerIds (must be a non-empty array of strings)" });
    return;
  }

  try {
    logger.info({ account, offerIds }, "nft: preparing cancel offer tx");
    const tx = await prepareCancelOfferTx({ account, offerIds, networkUrl });
    logger.info({ account, offerIds }, "nft: cancel offer tx prepared");
    res.json(tx);
  } catch (err) {
    logger.error({ account, offerIds, err }, "nft: prepare cancel offer tx failed");
    res.status(500).json({ error: "Internal server error" });
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
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/nft/offers/incoming/:address/:nftokenId
 * Returns sell offers for a given NFToken targeted at the given address (or open offers).
 */
router.get("/offers/incoming/:address/:nftokenId", async (req: Request, res: Response): Promise<void> => {
  const { address, nftokenId } = req.params;
  const networkUrl = req.query["networkUrl"] as string | undefined;

  if (!isValidXrplAddress(address)) {
    res.status(400).json({ error: "Invalid XRPL address" });
    return;
  }
  if (!isValidNftokenId(nftokenId)) {
    res.status(400).json({ error: "Invalid nftokenId: must be a 64-char hex string" });
    return;
  }

  try {
    logger.info({ address, nftokenId }, "nft: fetching incoming offers");
    const offers = await getIncomingOffers(address, nftokenId, networkUrl);
    logger.info({ address, nftokenId, count: offers.length }, "nft: incoming offers fetched");
    res.json({ offers });
  } catch (err) {
    logger.error({ address, nftokenId, err }, "nft: fetch incoming offers failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/nft/offers/incoming-for-account/:address
 * Returns all pending sell offers where Destination === address (offers sent to this wallet).
 */
router.get("/offers/incoming-for-account/:address", async (req: Request, res: Response): Promise<void> => {
  const { address } = req.params;
  const networkUrl = req.query["networkUrl"] as string | undefined;

  if (!isValidXrplAddress(address)) {
    res.status(400).json({ error: "Invalid XRPL address" });
    return;
  }

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
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/nft/list/:address
 * Returns all NFTs owned by the given XRPL address.
 */
router.get("/list/:address", async (req: Request, res: Response): Promise<void> => {
  const { address } = req.params;
  const networkUrl = req.query["networkUrl"] as string | undefined;

  if (!isValidXrplAddress(address)) {
    res.status(400).json({ error: "Invalid XRPL address" });
    return;
  }

  try {
    logger.info({ address }, "nft: listing account NFTs");
    const nfts = await getAccountNFTs(address, networkUrl);
    logger.info({ address, count: nfts.length }, "nft: account NFTs fetched");
    res.json({ account: address, nfts, count: nfts.length });
  } catch (err) {
    logger.error({ address, err }, "nft: list account NFTs failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/nft/offers/outgoing/:address
 * Returns all pending NFT offers created by the given address.
 */
router.get("/offers/outgoing/:address", async (req: Request, res: Response): Promise<void> => {
  const { address } = req.params;
  const networkUrl = req.query["networkUrl"] as string | undefined;

  if (!isValidXrplAddress(address)) {
    res.status(400).json({ error: "Invalid XRPL address" });
    return;
  }

  try {
    logger.info({ address }, "nft: fetching outgoing offers");
    const offers = await getOutgoingOffers(address, networkUrl);
    logger.info({ address, count: offers.length }, "nft: outgoing offers fetched");
    res.json({ offers });
  } catch (err) {
    logger.error({ address, err }, "nft: fetch outgoing offers failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/nft/offer/:offerId
 * Returns offer details (sequence, nftokenId, destination) for a given NFTokenOffer ID.
 */
router.get("/offer/:offerId", async (req: Request, res: Response): Promise<void> => {
  const { offerId } = req.params;
  const networkUrl = req.query["networkUrl"] as string | undefined;
  try {
    const details = await getOfferDetails(offerId, networkUrl);
    res.json(details);
  } catch (err) {
    logger.error({ offerId, err }, "nft: get offer details failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// Issuer-signed endpoints (backend signs with ISSUER_SEED — no Otsu needed)
// ---------------------------------------------------------------------------

function getIssuerSeed(res: Response): string | null {
  const seed = process.env.ISSUER_SEED;
  if (!seed) {
    res.status(500).json({ error: "ISSUER_SEED not configured on server" });
    return null;
  }
  return seed;
}

/**
 * POST /api/nft/issuer-mint
 * Mints an NFT using the server-side ISSUER_SEED wallet.
 * Body: { taxon, uri?, transferFee?, flags? }
 */
router.post("/issuer-mint", async (req: Request, res: Response): Promise<void> => {
  const seed = getIssuerSeed(res);
  if (!seed) return;
  const { taxon, uri, transferFee, flags } = req.body;
  if (taxon === undefined || typeof taxon !== "number" || !Number.isInteger(taxon) || taxon < 0) {
    res.status(400).json({ error: "Missing or invalid field: taxon" });
    return;
  }
  try {
    logger.info({ taxon, uri, flags }, "nft: issuer minting");
    const result = await mintNFT({ seed, taxon, uri, transferFee, flags });
    logger.info({ account: result.account, nftokenId: result.nftokenId }, "nft: issuer minted");
    res.json(result);
  } catch (err) {
    logger.error({ err }, "nft: issuer mint failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/nft/issuer-transfer-offer
 * Creates an NFT sell offer using the server-side ISSUER_SEED wallet.
 * Body: { nftokenId, destination? }
 */
router.post("/issuer-transfer-offer", async (req: Request, res: Response): Promise<void> => {
  const seed = getIssuerSeed(res);
  if (!seed) return;
  const { nftokenId, destination } = req.body;
  if (!nftokenId || typeof nftokenId !== "string") {
    res.status(400).json({ error: "Missing required field: nftokenId" });
    return;
  }
  if (!isValidNftokenId(nftokenId)) {
    res.status(400).json({ error: "Invalid nftokenId: must be a 64-char hex string" });
    return;
  }
  if (destination !== undefined && !isValidXrplAddress(destination)) {
    res.status(400).json({ error: "Invalid XRPL address: destination" });
    return;
  }
  try {
    logger.info({ nftokenId, destination }, "nft: issuer creating transfer offer");
    const result = await createTransferOffer({ seed, nftokenId, destination });
    logger.info({ nftokenId, offerId: result.offerId }, "nft: issuer transfer offer created");
    res.json(result);
  } catch (err) {
    logger.error({ err }, "nft: issuer transfer offer failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/nft/issuer-cancel-offer
 * Cancels one or more NFT sell offers using the server-side ISSUER_SEED wallet.
 * Body: { offerIds }
 */
router.post("/issuer-cancel-offer", async (req: Request, res: Response): Promise<void> => {
  const seed = getIssuerSeed(res);
  if (!seed) return;
  const { offerIds } = req.body;
  if (!Array.isArray(offerIds) || offerIds.length === 0 || offerIds.some((id) => typeof id !== "string")) {
    res.status(400).json({ error: "Missing or invalid field: offerIds (must be a non-empty array of strings)" });
    return;
  }
  try {
    logger.info({ offerIds }, "nft: issuer cancelling offers");
    const result = await cancelNFTOffer({ seed, offerIds });
    logger.info({ offerIds, txHash: result.txHash }, "nft: issuer offers cancelled");
    res.json(result);
  } catch (err) {
    logger.error({ err }, "nft: issuer cancel offer failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/nft/issuer-burn
 * Burns an NFT using the server-side ISSUER_SEED wallet.
 * Body: { nftokenId }
 */
router.post("/issuer-burn", async (req: Request, res: Response): Promise<void> => {
  const seed = getIssuerSeed(res);
  if (!seed) return;
  const { nftokenId } = req.body;
  if (!nftokenId || typeof nftokenId !== "string") {
    res.status(400).json({ error: "Missing required field: nftokenId" });
    return;
  }
  if (!isValidNftokenId(nftokenId)) {
    res.status(400).json({ error: "Invalid nftokenId: must be a 64-char hex string" });
    return;
  }
  try {
    logger.info({ nftokenId }, "nft: issuer burning");
    const result = await burnNFT({ seed, nftokenId });
    logger.info({ nftokenId, txHash: result.txHash }, "nft: issuer burned");
    res.json(result);
  } catch (err) {
    logger.error({ err }, "nft: issuer burn failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
