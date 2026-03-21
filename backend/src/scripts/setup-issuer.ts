import { Client, Wallet } from "xrpl";

const NETWORK = process.env.XRPL_NETWORK ?? "wss://wasm.devnet.rippletest.net:51233";
const FAUCET = process.env.XRPL_FAUCET_URL ?? "https://faucet.devnet.rippletest.net/accounts";

async function main() {
  const wallet = Wallet.generate();
  console.log("\n Generated issuer wallet:");
  console.log("  Address :", wallet.address);
  console.log("  Seed    :", wallet.seed);

  console.log("\n Funding via WASM devnet faucet...");
  const res = await fetch(FAUCET, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ destination: wallet.address, userAgent: "edelpacta-setup" }),
  });

  if (!res.ok) {
    console.error(" Faucet request failed:", res.statusText);
    console.error(" Fund it manually at https://xrpl.org/resources/dev-tools/xrp-faucets");
  } else {
    const data = await res.json() as Record<string, unknown>;
    console.log(" Funded! Balance:", (data["account"] as Record<string, unknown>)?.["balance"] ?? "check explorer");
  }

  const client = new Client(NETWORK);
  await client.connect();
  try {
    const info = await client.request({ command: "account_info", account: wallet.address, ledger_index: "validated" });
    console.log(" Account active on ledger. XRP balance:", info.result.account_data.Balance);
  } catch {
    console.warn(" Account not yet visible on ledger — it may take a few seconds.");
  } finally {
    await client.disconnect();
  }

  console.log("\n Add this to your .env file:");
  console.log(`  ISSUER_SEED=${wallet.seed}`);
  console.log("\n Then restart the backend.\n");
}

main().catch(console.error);
