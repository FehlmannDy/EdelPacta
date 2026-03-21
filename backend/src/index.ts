import express, { Request, Response, NextFunction } from "express";
import nftRouter from "./routes/nft";
import kycRouter from "./routes/kyc";
import ipfsRouter from "./routes/ipfs";
import logger from "./logger";

const app = express();
const PORT = process.env.PORT ?? 8080;

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

// Unhandled error middleware
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, "unhandled error");
  res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, () => {
  logger.info({ port: PORT, network: "wss://wasm.devnet.rippletest.net:51233" }, "server started");
});
