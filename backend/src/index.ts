import express, { Request, Response, NextFunction } from "express";
import nftRouter from "./routes/nft";
import kycRouter from "./routes/kyc";
import escrowRouter from "./routes/escrow";
import logger from "./logger";

// ── Startup validation ────────────────────────────────────
function validateEnvironment() {
  const required: [string, string | undefined][] = [
    ["ISSUER_ADDRESS", process.env.ISSUER_ADDRESS],
    ["BETAID_ISSUER_DID", process.env.BETAID_ISSUER_DID],
    ["ISSUER_DID", process.env.ISSUER_DID],
    // ORACLE_SEED may fall back to ISSUER_SEED; at least one must be present
    ["ORACLE_SEED or ISSUER_SEED", process.env.ORACLE_SEED ?? process.env.ISSUER_SEED],
  ];
  const missing = required.filter(([, v]) => !v).map(([k]) => k);
  if (missing.length > 0) {
    logger.error({ missing }, "missing required environment variables — server cannot start");
    process.exit(1);
  }
}

validateEnvironment();

// ── Simple in-memory rate limiter ─────────────────────────
function createRateLimiter(windowMs: number, max: number) {
  const store = new Map<string, { count: number; resetAt: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
    const now = Date.now();
    let entry = store.get(ip);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      store.set(ip, entry);
    }
    entry.count++;
    if (entry.count > max) {
      res.status(429).json({ error: "Too many requests" });
      return;
    }
    next();
  };
}

// 300 req/min globally — protects against DoS without affecting legitimate polling
const globalLimiter = createRateLimiter(60_000, 300);

const app = express();
const PORT = process.env.PORT ?? 8080;

// CORS — allow buyer frontend (and any configured origin)
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS ?? "http://localhost:3002")
  .split(",")
  .map((o) => o.trim());

app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  if (req.method === "OPTIONS") { res.sendStatus(204); return; }
  next();
});

app.use(express.json({ limit: "1mb" }));
app.use(globalLimiter);

// Request logging
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - start;
    const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
    logger[level]({ method: req.method, url: req.url, status: res.statusCode, ms }, "request");
  });
  next();
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/nft", nftRouter);
app.use("/api/kyc", kycRouter);
app.use("/api/escrow", escrowRouter);

// Unhandled error middleware
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, "unhandled error");
  res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, () => {
  logger.info({ port: PORT, network: process.env.XRPL_NETWORK ?? "wss://wasm.devnet.rippletest.net:51233" }, "server started");
});
