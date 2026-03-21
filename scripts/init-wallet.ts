/**
 * init-wallet.ts
 *
 * Generates a new XRPL issuer wallet, funds it via the devnet faucet,
 * and writes ISSUER_SEED + ISSUER_ADDRESS into the root .env file.
 *
 * Usage (from repo root):
 *   bun scripts/init-wallet.ts
 */

import { Client, Wallet } from "../backend/node_modules/xrpl/dist/npm/index.js";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";

const NETWORK = "wss://wasm.devnet.rippletest.net:51233";
const FAUCET_URL = "https://faucet.devnet.rippletest.net/accounts";
const ENV_PATH = resolve(import.meta.dir, "../.env");

// ---------------------------------------------------------------------------
// .env helpers
// ---------------------------------------------------------------------------

function readEnv(): Map<string, string> {
  const map = new Map<string, string>();
  if (!existsSync(ENV_PATH)) return map;
  for (const line of readFileSync(ENV_PATH, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    map.set(trimmed.slice(0, idx).trim(), trimmed.slice(idx + 1).trim());
  }
  return map;
}

function writeEnv(map: Map<string, string>): void {
  const lines: string[] = [];
  for (const [k, v] of map) {
    lines.push(`${k}=${v}`);
  }
  writeFileSync(ENV_PATH, lines.join("\n") + "\n", "utf-8");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const env = readEnv();

  // Guard: don't overwrite an existing seed
  if (env.get("ISSUER_SEED")) {
    console.log("⚠️  ISSUER_SEED is already set in .env — aborting to avoid overwriting.");
    console.log("   Delete ISSUER_SEED and ISSUER_ADDRESS from .env manually if you want to regenerate.");
    process.exit(0);
  }

  console.log("Connecting to XRPL devnet…");
  const client = new Client(NETWORK);
  await client.connect();

  console.log("Generating wallet and requesting devnet funding…");
  const { wallet, balance } = await client.fundWallet(null, { faucetHost: FAUCET_URL });
  await client.disconnect();

  console.log("");
  console.log("✅  Wallet created and funded!");
  console.log(`    Address : ${wallet.address}`);
  console.log(`    Seed    : ${wallet.seed}`);
  console.log(`    Balance : ${balance} XRP (devnet)`);
  console.log("");

  // Write to .env
  env.set("ISSUER_SEED", wallet.seed!);
  env.set("ISSUER_ADDRESS", wallet.address);
  writeEnv(env);

  console.log(`✅  Written to ${ENV_PATH}`);
  console.log("");
  console.log("Next steps:");
  console.log("  1. Fill in ISSUER_DID      — the DID of the EdelPacta estate-credential issuer (swiyu trust infrastructure)");
  console.log("  2. Fill in BETAID_ISSUER_DID — the DID of the betaid Swiss e-ID issuer (swiyu trust infrastructure)");
  console.log("  3. Set VITE_IPFS_GATEWAY if you are using a remote IPFS gateway");
  console.log("  4. Run: docker compose up --build");
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
