import { Router, Request, Response } from "express";
import logger from "../logger";
import {
  startVerification,
  pollVerificationStatus,
  checkCredentialStatus,
  issueCredential,
  prepareAcceptCredential,
  deleteCredentials,
  getIssuerAddress,
  CREDENTIAL_TYPE_HEX,
  CREDENTIAL_TYPE_TAX_HEX,
} from "../services/kycService";

const XRPL_ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
const VALID_ROLES = ["vendor", "buyer"];
const VALID_STEPS = ["identity", "tax"];

function isValidXrplAddress(v: unknown): v is string {
  return typeof v === "string" && XRPL_ADDRESS_RE.test(v);
}
function isValidRole(v: unknown): boolean {
  return v === undefined || (typeof v === "string" && VALID_ROLES.includes(v));
}
function isValidStep(v: unknown): boolean {
  return v === undefined || (typeof v === "string" && VALID_STEPS.includes(v));
}

function credentialTypesForRole(role?: string, step?: string): string[] {
  if (role === "vendor") {
    if (step === "identity") return [CREDENTIAL_TYPE_HEX];
    if (step === "tax") return [CREDENTIAL_TYPE_TAX_HEX];
    return [CREDENTIAL_TYPE_HEX, CREDENTIAL_TYPE_TAX_HEX]; // status check: both
  }
  return [CREDENTIAL_TYPE_HEX];
}

const router = Router();

/**
 * GET /api/kyc/issuer
 * Returns the issuer's XRPL address (needed by frontend for reference).
 */
router.get("/issuer", (_req: Request, res: Response): void => {
  try {
    res.json({ issuer: getIssuerAddress() });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/kyc/status/:address
 * Returns whether the address has an accepted/pending/no SWIYU_KYC credential.
 */
router.get("/status/:address", async (req: Request, res: Response): Promise<void> => {
  const { address } = req.params;
  const role = req.query["role"] as string | undefined;
  const step = req.query["step"] as string | undefined;
  if (!isValidXrplAddress(address)) {
    res.status(400).json({ error: "Invalid XRPL address" });
    return;
  }
  if (!isValidRole(role)) {
    res.status(400).json({ error: "Invalid role: must be 'vendor' or 'buyer'" });
    return;
  }
  if (!isValidStep(step)) {
    res.status(400).json({ error: "Invalid step: must be 'identity' or 'tax'" });
    return;
  }
  const types = credentialTypesForRole(role, step);
  try {
    const status = await checkCredentialStatus(address, types);
    logger.info({ address, status }, "kyc: credential status checked");
    res.json({ status });
  } catch (err) {
    logger.error({ address, err }, "kyc: failed to check credential status");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/kyc/start
 * Starts a verification session with verifier.edel-id.ch.
 * Returns { verificationId, verificationUrl } — show verificationUrl as QR code.
 */
router.post("/start", async (req: Request, res: Response): Promise<void> => {
  const role = req.body?.["role"] as string | undefined;
  const step = req.body?.["step"] as string | undefined;
  if (!isValidRole(role)) {
    res.status(400).json({ error: "Invalid role: must be 'vendor' or 'buyer'" });
    return;
  }
  if (!isValidStep(step)) {
    res.status(400).json({ error: "Invalid step: must be 'identity' or 'tax'" });
    return;
  }
  try {
    const result = await startVerification(role, step);
    logger.info({ verificationId: result.verificationId, role }, "kyc: verification session started");
    res.json(result);
  } catch (err) {
    logger.error({ err }, "kyc: failed to start verification");
    res.status(500).json({ error: "Internal server error" });
  }
});

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * GET /api/kyc/stream/:verificationId
 * SSE — polls swiyu verifier every 2s until SUCCESS/FAILED or timeout.
 * Emits: { state: "PENDING" | "SUCCESS" | "ERROR", verifiedClaims? }
 */
router.get("/stream/:verificationId", async (req: Request, res: Response): Promise<void> => {
  const { verificationId } = req.params;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  logger.info({ verificationId }, "kyc: SSE polling started");

  let clientGone = false;
  req.on("close", () => { clientGone = true; });

  const send = (payload: Record<string, unknown>) =>
    res.write(`data: ${JSON.stringify(payload)}\n\n`);

  const deadline = Date.now() + POLL_TIMEOUT_MS;

  try {
    while (!res.destroyed && !clientGone && Date.now() < deadline) {
      const result = await pollVerificationStatus(verificationId);

      if (result.state === "SUCCESS") {
        logger.info({ verificationId }, "kyc: verification SUCCESS");
        send({ state: "SUCCESS", verifiedClaims: result.verifiedClaims ?? [] });
        break;
      }

      if (result.state === "FAILED") {
        logger.warn({ verificationId, error: result.error }, "kyc: verification FAILED");
        send({ state: "ERROR", error: result.error ?? "Verification failed" });
        break;
      }

      // Still PENDING — notify client and wait before next poll
      send({ state: "PENDING" });
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    if (Date.now() >= deadline && !res.destroyed) {
      logger.warn({ verificationId }, "kyc: verification timed out");
      send({ state: "ERROR", error: "Verification timed out" });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ verificationId, err }, "kyc: SSE polling error");
    if (!res.destroyed) send({ state: "ERROR", error: msg });
  }

  res.end();
  logger.info({ verificationId }, "kyc: SSE stream closed");
});

/**
 * POST /api/kyc/issue
 * Issues a SWIYU_KYC CredentialCreate for the given address (backend signed).
 * Call this after receiving a SUCCESS event from the SSE stream.
 * Body: { address }
 */
router.post("/issue", async (req: Request, res: Response): Promise<void> => {
  const { address } = req.body;
  if (!address || typeof address !== "string") {
    res.status(400).json({ error: "Missing required field: address" });
    return;
  }
  if (!isValidXrplAddress(address)) {
    res.status(400).json({ error: "Invalid XRPL address" });
    return;
  }
  const role = req.body["role"] as string | undefined;
  const step = req.body["step"] as string | undefined;
  if (!isValidRole(role)) {
    res.status(400).json({ error: "Invalid role: must be 'vendor' or 'buyer'" });
    return;
  }
  if (!isValidStep(step)) {
    res.status(400).json({ error: "Invalid step: must be 'identity' or 'tax'" });
    return;
  }
  const types = credentialTypesForRole(role, step);
  try {
    logger.info({ address, types }, "kyc: issuing credentials");
    const result = await issueCredential(address, types);
    logger.info({ address, txHash: result.txHash }, "kyc: credentials issued");
    res.json(result);
  } catch (err) {
    logger.error({ address, err }, "kyc: credential issuance failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/kyc/prepare-accept/:address
 * Returns an unsigned CredentialAccept transaction for the wallet to sign.
 */
router.get("/prepare-accept/:address", async (req: Request, res: Response): Promise<void> => {
  const { address } = req.params;
  const role = req.query["role"] as string | undefined;
  const step = req.query["step"] as string | undefined;
  if (!isValidXrplAddress(address)) {
    res.status(400).json({ error: "Invalid XRPL address" });
    return;
  }
  if (!isValidRole(role)) {
    res.status(400).json({ error: "Invalid role: must be 'vendor' or 'buyer'" });
    return;
  }
  if (!isValidStep(step)) {
    res.status(400).json({ error: "Invalid step: must be 'identity' or 'tax'" });
    return;
  }
  const types = credentialTypesForRole(role, step);
  try {
    const txs = await prepareAcceptCredential(address, types);
    logger.info({ address, count: txs.length }, "kyc: CredentialAccept txs prepared");
    res.json({ txs });
  } catch (err) {
    logger.error({ address, err }, "kyc: failed to prepare CredentialAccept txs");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/kyc/delete
 * Issuer deletes KYC credentials for a given subject address.
 * Body: { address, role? }
 */
router.post("/delete", async (req: Request, res: Response): Promise<void> => {
  const { address } = req.body;
  if (!address || typeof address !== "string") {
    res.status(400).json({ error: "Missing required field: address" });
    return;
  }
  if (!isValidXrplAddress(address)) {
    res.status(400).json({ error: "Invalid XRPL address" });
    return;
  }
  const role = req.body["role"] as string | undefined;
  if (!isValidRole(role)) {
    res.status(400).json({ error: "Invalid role: must be 'vendor' or 'buyer'" });
    return;
  }
  const types = credentialTypesForRole(role);
  try {
    logger.info({ address, types }, "kyc: deleting credentials");
    await deleteCredentials(address, types);
    logger.info({ address }, "kyc: credentials deleted");
    res.json({ ok: true });
  } catch (err) {
    logger.error({ address, err }, "kyc: credential deletion failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
