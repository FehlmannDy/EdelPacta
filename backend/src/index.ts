import express, { Request, Response, NextFunction } from "express";
import nftRouter from "./routes/nft";
import kycRouter from "./routes/kyc";
import ipfsRouter from "./routes/ipfs";
import escrowRouter from "./routes/escrow";
import logger from "./logger";

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

app.use(express.json());

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
app.use("/api/ipfs", ipfsRouter);
app.use("/api/escrow", escrowRouter);

// Unhandled error middleware
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, "unhandled error");
  res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, () => {
  logger.info({ port: PORT, network: process.env.XRPL_NETWORK ?? "wss://wasm.devnet.rippletest.net:51233" }, "server started");
});
