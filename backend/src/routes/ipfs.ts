import { Router, Request, Response } from "express";
import multer from "multer";
import { create } from "kubo-rpc-client";
import logger from "../logger";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const KUBO_URL = process.env.KUBO_URL ?? "http://ipfs:5001";

/**
 * POST /api/ipfs/upload
 * Accepts a multipart file, pins it to the local Kubo node, returns the CID.
 * Body: multipart/form-data with field "file"
 * Response: { cid, uri }  — uri is the ipfs:// URI ready to use as NFT URI
 */
router.post("/upload", upload.single("file"), async (req: Request, res: Response): Promise<void> => {
  if (!req.file) {
    res.status(400).json({ error: "Missing file" });
    return;
  }

  try {
    logger.info({ filename: req.file.originalname, size: req.file.size }, "ipfs: uploading file");

    const ipfs = create({ url: KUBO_URL });
    const result = await ipfs.add(req.file.buffer, { pin: true });
    const cid = result.cid.toString();

    logger.info({ cid, filename: req.file.originalname }, "ipfs: file pinned");
    res.json({ cid, uri: `ipfs://${cid}` });
  } catch (err) {
    logger.error({ err }, "ipfs: upload failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

export default router;
