import { Request, Response, Router } from "express";
import logger from "../logger";
import {
  createEscrow,
  finishEscrow,
  getAddressInfo,
  getEscrowsByBuyer,
  getEscrowsBySeller,
  getPendingEscrows,
  getSuccessfulEscrowsBySeller,
  prepareEscrowCancel,
  preparePayment,
} from "../services/escrowService";

const router = Router();

/**
 * GET /api/escrow/address-info/:address
 * Returns XRP balance for a given XRPL address.
 */
router.get(
  "/address-info/:address",
  async (req: Request, res: Response): Promise<void> => {
    const { address } = req.params;
    try {
      const info = await getAddressInfo(address);
      res.json(info);
    } catch (err) {
      logger.error({ err }, "escrow: get address info failed");
      res
        .status(500)
        .json({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  },
);

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
    if (typeof amountXrp !== "number" || amountXrp <= 0) {
      res.status(400).json({ error: "Missing or invalid field: amountXrp" });
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
        .json({ error: err instanceof Error ? err.message : "Unknown error" });
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
  if (!sellerAddress || typeof sellerAddress !== "string") {
    res.status(400).json({ error: "Missing required field: sellerAddress" });
    return;
  }
  if (!nftId || typeof nftId !== "string") {
    res.status(400).json({ error: "Missing required field: nftId" });
    return;
  }
  if (typeof amountXrp !== "number" || amountXrp <= 0) {
    res
      .status(400)
      .json({
        error:
          "Missing or invalid field: amountXrp (must be a positive number)",
      });
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
      .json({ error: err instanceof Error ? err.message : "Unknown error" });
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

  if (typeof escrowSequence !== "number") {
    res
      .status(400)
      .json({
        error: "Missing or invalid field: escrowSequence (must be a number)",
      });
    return;
  }
  if (!nftId || typeof nftId !== "string") {
    res.status(400).json({ error: "Missing required field: nftId" });
    return;
  }
  if (!buyerAddress || typeof buyerAddress !== "string") {
    res.status(400).json({ error: "Missing required field: buyerAddress" });
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
      .json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/**
 * GET /api/escrow/pending/:address
 * Returns pending escrow objects on-chain for the given address.
 */
router.get(
  "/pending/:address",
  async (req: Request, res: Response): Promise<void> => {
    const { address } = req.params;
    try {
      const escrows = await getPendingEscrows(address);
      res.json({ escrows });
    } catch (err) {
      logger.error({ address, err }, "escrow: get pending failed");
      res
        .status(500)
        .json({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  },
);

/**
 * GET /api/escrow/by-buyer/:address
 * Returns on-chain escrows created by the notary that belong to the given buyer address
 * (matched via the BUYER memo embedded in each EscrowCreate transaction).
 */
router.get(
  "/by-buyer/:address",
  async (req: Request, res: Response): Promise<void> => {
    const { address } = req.params;
    try {
      const escrows = await getEscrowsByBuyer(address);
      res.json({ escrows });
    } catch (err) {
      logger.error({ address, err }, "escrow: get by-buyer failed");
      res
        .status(500)
        .json({ error: err instanceof Error ? err.message : "Unknown error" });
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
    try {
      const escrows = await getEscrowsBySeller(address);
      res.json({ escrows });
    } catch (err) {
      logger.error({ address, err }, "escrow: get by-seller failed");
      res
        .status(500)
        .json({ error: err instanceof Error ? err.message : "Unknown error" });
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
    try {
      const escrows = await getSuccessfulEscrowsBySeller(address);
      res.json({ escrows });
    } catch (err) {
      logger.error({ address, err }, "escrow: get successful-by-seller failed");
      res
        .status(500)
        .json({ error: err instanceof Error ? err.message : "Unknown error" });
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
      res
        .status(400)
        .json({ error: "Missing required field: cancellerAddress" });
      return;
    }
    if (!ownerAddress || typeof ownerAddress !== "string") {
      res.status(400).json({ error: "Missing required field: ownerAddress" });
      return;
    }
    if (typeof offerSequence !== "number") {
      res
        .status(400)
        .json({
          error: "Missing or invalid field: offerSequence (must be a number)",
        });
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
        .json({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  },
);

export default router;
