import { Request, Response, Router } from "express";
import logger from "../logger";
import {
  createEscrow,
  finishEscrow,
  getEscrowsByBuyer,
  getEscrowsBySeller,
  getSuccessfulEscrowsBySeller,
  prepareEscrowCancel,
  preparePayment,
} from "../services/escrowService";

const XRPL_ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
const NFTOKEN_ID_RE = /^[0-9A-F]{64}$/i;

function isValidXrplAddress(v: unknown): v is string {
  return typeof v === "string" && XRPL_ADDRESS_RE.test(v);
}
function isValidNftokenId(v: unknown): v is string {
  return typeof v === "string" && NFTOKEN_ID_RE.test(v);
}
function isPositiveFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}
function isPositiveInteger(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}

const router = Router();

/**
 * POST /api/escrow/prepare-payment
 * Returns an unsigned Payment tx for the buyer to sign with their Otsu wallet.
 * Body: { buyerAddress, amountXrp }
 * Response: { tx }
 */
router.post(
  "/prepare-payment",
  async (req: Request, res: Response): Promise<void> => {
    const { buyerAddress, amountXrp } = req.body as {
      buyerAddress?: unknown;
      amountXrp?: unknown;
    };
    if (!buyerAddress || typeof buyerAddress !== "string") {
      res.status(400).json({ error: "Missing required field: buyerAddress" });
      return;
    }
    if (!isValidXrplAddress(buyerAddress)) {
      res.status(400).json({ error: "Invalid XRPL address: buyerAddress" });
      return;
    }
    if (!isPositiveFiniteNumber(amountXrp)) {
      res.status(400).json({ error: "Missing or invalid field: amountXrp (must be a positive finite number)" });
      return;
    }
    try {
      const { tx, reserveOverheadXrp } = await preparePayment(
        buyerAddress,
        amountXrp,
      );
      res.json({ tx, reserveOverheadXrp });
    } catch (err) {
      logger.error({ err }, "escrow: prepare payment failed");
      res
        .status(500)
        .json({ error: "Internal server error" });
    }
  },
);

/**
 * POST /api/escrow/create
 * Submits the buyer's signed Payment, then creates EscrowCreate from the issuer account.
 * The WASM FinishFunction is embedded and backend-signed — no buyer seed required.
 *
 * Body: { paymentTxBlob, buyerAddress, sellerAddress, nftId, amountXrp }
 * Response: { escrowSequence, hash, escrowAccount, buyerAddress, cancelAfter }
 */
router.post("/create", async (req: Request, res: Response): Promise<void> => {
  const { paymentTxBlob, buyerAddress, sellerAddress, nftId, amountXrp } =
    req.body as {
      paymentTxBlob?: unknown;
      buyerAddress?: unknown;
      sellerAddress?: unknown;
      nftId?: unknown;
      amountXrp?: unknown;
    };

  if (!paymentTxBlob || typeof paymentTxBlob !== "string") {
    res.status(400).json({ error: "Missing required field: paymentTxBlob" });
    return;
  }
  if (!buyerAddress || typeof buyerAddress !== "string") {
    res.status(400).json({ error: "Missing required field: buyerAddress" });
    return;
  }
  if (!isValidXrplAddress(buyerAddress)) {
    res.status(400).json({ error: "Invalid XRPL address: buyerAddress" });
    return;
  }
  if (!sellerAddress || typeof sellerAddress !== "string") {
    res.status(400).json({ error: "Missing required field: sellerAddress" });
    return;
  }
  if (!isValidXrplAddress(sellerAddress)) {
    res.status(400).json({ error: "Invalid XRPL address: sellerAddress" });
    return;
  }
  if (!nftId || typeof nftId !== "string") {
    res.status(400).json({ error: "Missing required field: nftId" });
    return;
  }
  if (!isValidNftokenId(nftId)) {
    res.status(400).json({ error: "Invalid nftId: must be a 64-char hex string" });
    return;
  }
  if (!isPositiveFiniteNumber(amountXrp)) {
    res.status(400).json({ error: "Missing or invalid field: amountXrp (must be a positive finite number)" });
    return;
  }

  try {
    logger.info(
      { buyerAddress, sellerAddress, nftId, amountXrp },
      "escrow: create request",
    );
    const result = await createEscrow({
      paymentTxBlob,
      buyerAddress,
      sellerAddress,
      nftId,
      amountXrp,
    });
    res.json(result);
  } catch (err) {
    logger.error({ err }, "escrow: create failed");
    res
      .status(500)
      .json({ error: "Internal server error" });
  }
});

/**
 * POST /api/escrow/finish
 * Submits EscrowFinish with 6 memos (uses ORACLE_SEED for all backend operations).
 * The WASM verifies: notaire identity, seller KYC, buyer NFT ownership, dual signatures.
 *
 * Body: { escrowSequence, nftId, buyerAddress }
 * Response: { hash }
 */
router.post("/finish", async (req: Request, res: Response): Promise<void> => {
  const { escrowSequence, nftId, buyerAddress } = req.body as {
    escrowSequence?: unknown;
    nftId?: unknown;
    buyerAddress?: unknown;
  };

  if (!isPositiveInteger(escrowSequence)) {
    res.status(400).json({ error: "Missing or invalid field: escrowSequence (must be a positive integer)" });
    return;
  }
  if (!nftId || typeof nftId !== "string") {
    res.status(400).json({ error: "Missing required field: nftId" });
    return;
  }
  if (!isValidNftokenId(nftId)) {
    res.status(400).json({ error: "Invalid nftId: must be a 64-char hex string" });
    return;
  }
  if (!buyerAddress || typeof buyerAddress !== "string") {
    res.status(400).json({ error: "Missing required field: buyerAddress" });
    return;
  }
  if (!isValidXrplAddress(buyerAddress)) {
    res.status(400).json({ error: "Invalid XRPL address: buyerAddress" });
    return;
  }

  try {
    logger.info(
      { escrowSequence, nftId, buyerAddress },
      "escrow: finish request",
    );
    const result = await finishEscrow({ escrowSequence, nftId, buyerAddress });
    res.json(result);
  } catch (err) {
    logger.error({ err }, "escrow: finish failed");
    res
      .status(500)
      .json({ error: "Internal server error" });
  }
});

/**
 * GET /api/escrow/by-buyer/:address
 * Returns on-chain escrows created by the notary that belong to the given buyer address
 * (matched via the BUYER memo embedded in each EscrowCreate transaction).
 */
router.get(
  "/by-buyer/:address",
  async (req: Request, res: Response): Promise<void> => {
    const { address } = req.params;
    if (!isValidXrplAddress(address)) {
      res.status(400).json({ error: "Invalid XRPL address" });
      return;
    }
    try {
      const escrows = await getEscrowsByBuyer(address);
      res.json({ escrows });
    } catch (err) {
      logger.error({ address, err }, "escrow: get by-buyer failed");
      res
        .status(500)
        .json({ error: "Internal server error" });
    }
  },
);

/**
 * GET /api/escrow/by-seller/:address
 * Returns on-chain escrows where the given address is the Destination (seller).
 * Enriched with NftId from the EscrowCreate memo when available.
 */
router.get(
  "/by-seller/:address",
  async (req: Request, res: Response): Promise<void> => {
    const { address } = req.params;
    if (!isValidXrplAddress(address)) {
      res.status(400).json({ error: "Invalid XRPL address" });
      return;
    }
    try {
      const escrows = await getEscrowsBySeller(address);
      res.json({ escrows });
    } catch (err) {
      logger.error({ address, err }, "escrow: get by-seller failed");
      res
        .status(500)
        .json({ error: "Internal server error" });
    }
  },
);

/**
 * GET /api/escrow/successful-by-seller/:address
 * Returns successful/finalized smart escrows for the given seller address,
 * resolved from validated EscrowCreate + EscrowFinish transaction history.
 */
router.get(
  "/successful-by-seller/:address",
  async (req: Request, res: Response): Promise<void> => {
    const { address } = req.params;
    if (!isValidXrplAddress(address)) {
      res.status(400).json({ error: "Invalid XRPL address" });
      return;
    }
    try {
      const escrows = await getSuccessfulEscrowsBySeller(address);
      res.json({ escrows });
    } catch (err) {
      logger.error({ address, err }, "escrow: get successful-by-seller failed");
      res
        .status(500)
        .json({ error: "Internal server error" });
    }
  },
);

/**
 * POST /api/escrow/prepare-cancel
 * Returns an unsigned EscrowCancel transaction for the seller to sign with their wallet.
 * The escrow can only be cancelled on-chain after its CancelAfter time has passed.
 *
 * Body: { cancellerAddress, ownerAddress, offerSequence }
 * Response: unsigned tx object
 */
router.post(
  "/prepare-cancel",
  async (req: Request, res: Response): Promise<void> => {
    const { cancellerAddress, ownerAddress, offerSequence } = req.body as {
      cancellerAddress?: unknown;
      ownerAddress?: unknown;
      offerSequence?: unknown;
    };

    if (!cancellerAddress || typeof cancellerAddress !== "string") {
      res.status(400).json({ error: "Missing required field: cancellerAddress" });
      return;
    }
    if (!isValidXrplAddress(cancellerAddress)) {
      res.status(400).json({ error: "Invalid XRPL address: cancellerAddress" });
      return;
    }
    if (!ownerAddress || typeof ownerAddress !== "string") {
      res.status(400).json({ error: "Missing required field: ownerAddress" });
      return;
    }
    if (!isValidXrplAddress(ownerAddress)) {
      res.status(400).json({ error: "Invalid XRPL address: ownerAddress" });
      return;
    }
    if (!isPositiveInteger(offerSequence)) {
      res.status(400).json({ error: "Missing or invalid field: offerSequence (must be a positive integer)" });
      return;
    }

    try {
      logger.info(
        { cancellerAddress, ownerAddress, offerSequence },
        "escrow: prepare cancel",
      );
      const tx = await prepareEscrowCancel(
        cancellerAddress,
        ownerAddress,
        offerSequence,
      );
      res.json(tx);
    } catch (err) {
      logger.error({ err }, "escrow: prepare cancel failed");
      res
        .status(500)
        .json({ error: "Internal server error" });
    }
  },
);

export default router;
