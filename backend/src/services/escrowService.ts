import { createHash } from "crypto";
import { readFileSync } from "fs";
import { resolve } from "path";
import { XrplDefinitions, encode, encodeForSigning } from "ripple-binary-codec";
import * as keypairs from "ripple-keypairs";
import { Client, Wallet, decodeAccountID } from "xrpl";
import logger from "../logger";

const ENDPOINT =
  process.env.XRPL_NETWORK ?? "wss://wasm.devnet.rippletest.net:51233";
const NETWORK_ID = 2002;
const ESCROW_FINISH_NFT_WAIT_MS = Number(
  process.env.ESCROW_FINISH_NFT_WAIT_MS ?? "120000",
);

const WASM_PATH =
  process.env.ESCROW_WASM_PATH ??
  resolve(process.cwd(), "../contract/my_contract_devnet.wasm");

// ─── Custom Codec (FinishFunction, ComputationAllowance, etc.) ────────────────

const rawDefs = JSON.parse(
  readFileSync(
    resolve(
      process.cwd(),
      "node_modules/ripple-binary-codec/dist/enums/definitions.json",
    ),
    "utf8",
  ),
) as Record<string, unknown>;

const customDefs = new XrplDefinitions({
  ...(rawDefs as object),
  TRANSACTION_TYPES: {
    ...(rawDefs["TRANSACTION_TYPES"] as object),
    CredentialCreate: 58,
    CredentialAccept: 59,
    CredentialDelete: 60,
  },
  FIELDS: [
    ...((rawDefs["FIELDS"] as unknown[]) ?? []),
    [
      "FinishFunction",
      {
        nth: 32,
        isVLEncoded: true,
        isSerialized: true,
        isSigningField: true,
        type: "Blob",
      },
    ],
    [
      "ComputationAllowance",
      {
        nth: 72,
        isVLEncoded: false,
        isSerialized: true,
        isSigningField: true,
        type: "UInt32",
      },
    ],
    [
      "Subject",
      {
        nth: 24,
        isVLEncoded: true,
        isSerialized: true,
        isSigningField: true,
        type: "AccountID",
      },
    ],
    [
      "CredentialType",
      {
        nth: 31,
        isVLEncoded: true,
        isSerialized: true,
        isSigningField: true,
        type: "Blob",
      },
    ],
    [
      "URI",
      {
        nth: 5,
        isVLEncoded: true,
        isSerialized: true,
        isSigningField: true,
        type: "Blob",
      },
    ],
  ],
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toHex(str: string): string {
  return Buffer.from(str, "utf8").toString("hex").toUpperCase();
}

function signCustomTx(
  txObj: Record<string, unknown>,
  wallet: Wallet,
): { tx_blob: string; hash: string } {
  const txForSigning = { ...txObj, SigningPubKey: wallet.publicKey };
  const signingHex = encodeForSigning(txForSigning, customDefs);
  const sig = keypairs.sign(signingHex, wallet.privateKey);
  const tx_blob = encode({ ...txForSigning, TxnSignature: sig }, customDefs);
  const hash = createHash("sha512")
    .update(Buffer.from("54584E00" + tx_blob, "hex"))
    .digest()
    .slice(0, 32)
    .toString("hex")
    .toUpperCase();
  return { tx_blob, hash };
}

async function autofillBase(
  client: Client,
  account: string,
): Promise<{ sequence: number; medianFee: number; lastLedger: number; balanceXrp: number }> {
  const [accInfo, feeInfo, ledgerInfo] = await Promise.all([
    client.request({
      command: "account_info",
      account,
      ledger_index: "current",
    }),
    client.request({ command: "fee" }),
    client.request({ command: "ledger", ledger_index: "validated" }),
  ]);
  const accountData = accInfo.result.account_data as { Sequence: number; Balance: string };
  return {
    sequence: accountData.Sequence,
    balanceXrp: Number(accountData.Balance) / 1_000_000,
    medianFee: Number(
      (
        (feeInfo.result as Record<string, unknown>)["drops"] as Record<
          string,
          string
        >
      )["median_fee"],
    ),
    lastLedger:
      ((ledgerInfo.result as Record<string, unknown>)[
        "ledger_index"
      ] as number) + 100,
  };
}

async function submitAndCheck(
  client: Client,
  tx_blob: string,
  label: string,
): Promise<{ ok: boolean; engineResult: string; hash?: string }> {
  const result = await client.request({ command: "submit", tx_blob });
  const res = result.result as Record<string, unknown>;
  const eng = res["engine_result"] as string;
  const ok = eng.startsWith("tes") || eng === "terQUEUED";
  const hash = ((res["tx_json"] as Record<string, unknown> | undefined) ?? {})[
    "hash"
  ] as string | undefined;
  if (ok) {
    logger.info({ label, eng, hash }, "escrow: tx submitted");
  } else {
    logger.error(
      { label, eng, message: res["engine_result_message"] },
      "escrow: tx rejected",
    );
  }
  return { ok, engineResult: eng, hash };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForTransaction(
  client: Client,
  hash: string,
  timeoutMs = 30000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let delay = 1000;
  while (Date.now() < deadline) {
    await sleep(delay);
    try {
      const result = await client.request({ command: "tx", transaction: hash });
      const res = result.result as Record<string, unknown>;
      if (res["validated"] === true) return;
    } catch (_) {
      // tx not yet known — keep polling
    }
    delay = Math.min(delay * 2, 8000);
  }
  throw new Error(
    `Transaction ${hash} not validated on ledger after ${timeoutMs / 1000}s`,
  );
}

async function getXrpBalance(client: Client, address: string): Promise<string> {
  try {
    const r = await client.request({
      command: "account_info",
      account: address,
      ledger_index: "validated",
    });
    const balance = (r.result.account_data as { Balance: string }).Balance;
    return (Number(balance) / 1e6).toFixed(2) + " XRP";
  } catch (_) {
    return "0.00 XRP";
  }
}

// ─── Wallet helpers ───────────────────────────────────────────────────────────

export function getOracleWallet(): Wallet {
  const seed = process.env.ORACLE_SEED;
  if (!seed) throw new Error("ORACLE_SEED not configured");
  return Wallet.fromSeed(seed);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function getAddressInfo(
  address: string,
): Promise<{ address: string; balance: string }> {
  const client = new Client(ENDPOINT);
  await client.connect();
  try {
    const balance = await getXrpBalance(client, address);
    return { address, balance };
  } finally {
    await client.disconnect();
  }
}

async function activateBuyerAccount(
  client: Client,
  issuer: Wallet,
  buyerAddress: string,
): Promise<void> {
  const { sequence, medianFee, lastLedger } = await autofillBase(
    client,
    issuer.address,
  );
  const tx: Record<string, unknown> = {
    TransactionType: "Payment",
    Account: issuer.address,
    Destination: buyerAddress,
    Amount: "40000000", // 40 XRP in drops
    Sequence: sequence,
    LastLedgerSequence: lastLedger,
    Fee: String(Math.max(medianFee, 12)),
    NetworkID: NETWORK_ID,
  };
  const { tx_blob, hash } = signCustomTx(tx, issuer);
  const { ok, engineResult } = await submitAndCheck(
    client,
    tx_blob,
    "Payment(topup→buyer)",
  );
  if (!ok) throw new Error(`Failed to top up buyer account: ${engineResult}`);
  logger.info({ buyerAddress, hash }, "escrow: buyer account topped up");
  // No hash returned from submitAndCheck here; wait one ledger close (~4s) before proceeding.
  await sleep(4000);
}

// ─── Prepare unsigned Payment for buyer to sign with Otsu ─────────────────────

export async function preparePayment(
  buyerAddress: string,
  amountXrp: number,
): Promise<{ tx: Record<string, unknown>; reserveOverheadXrp: number; buyerBalanceXrp: number }> {
  const issuer = getOracleWallet();
  const wasmBytes = readFileSync(WASM_PATH).length;
  const reserveBlocks = Math.ceil(wasmBytes / 500);

  const client = new Client(ENDPOINT);
  await client.connect();
  try {
    const [{ sequence, medianFee, lastLedger, balanceXrp: buyerBalanceXrp }, serverInfo] = await Promise.all(
      [
        autofillBase(client, buyerAddress),
        client.request({ command: "server_info" }),
      ],
    );

    const ownerReserveXrp = (
      (serverInfo.result as Record<string, unknown>)["info"] as Record<
        string,
        unknown
      >
    )["validated_ledger"] as Record<string, number>;
    const reserveOverheadXrp =
      reserveBlocks * ownerReserveXrp["reserve_inc_xrp"];
    const totalDrops =
      Math.round(amountXrp * 1_000_000) +
      Math.round(reserveOverheadXrp * 1_000_000);

    return {
      tx: {
        TransactionType: "Payment",
        Account: buyerAddress,
        Destination: issuer.address,
        Amount: String(totalDrops),
        Sequence: sequence,
        LastLedgerSequence: lastLedger,
        Fee: String(Math.max(medianFee, 12)),
        NetworkID: NETWORK_ID,
      },
      reserveOverheadXrp,
      buyerBalanceXrp,
    };
  } finally {
    await client.disconnect();
  }
}

// ─── Create escrow from issuer account after buyer's payment ──────────────────

export interface CreateEscrowParams {
  paymentTxBlob: string; // signed Payment (buyer → issuer), signed by buyer via Otsu
  buyerAddress: string;
  sellerAddress: string;
  nftId: string;
  amountXrp: number;
}

export interface CreateEscrowResult {
  escrowSequence: number;
  hash: string;
  escrowAccount: string; // issuer address (Account of EscrowCreate)
  buyerAddress: string;
  cancelAfter: number;
}

export async function createEscrow(
  params: CreateEscrowParams,
): Promise<CreateEscrowResult> {
  const { paymentTxBlob, buyerAddress, sellerAddress, nftId, amountXrp } =
    params;
  const issuer = getOracleWallet();

  const wasmHex = readFileSync(WASM_PATH).toString("hex").toUpperCase();
  logger.info(
    {
      wasmBytes: wasmHex.length / 2,
      buyerAddress,
      escrowAccount: issuer.address,
      sellerAddress,
      nftId,
      amountXrp,
    },
    "escrow: creating",
  );

  const client = new Client(ENDPOINT);
  await client.connect();

  try {
    // 1 — Submit the buyer's signed Payment (buyer → issuer)
    const {
      ok: payOk,
      engineResult: payResult,
      hash: payHash,
    } = await submitAndCheck(client, paymentTxBlob, "Payment(buyer→issuer)");
    if (!payOk) {
      if (
        payResult === "tecUNFUNDED_PAYMENT" ||
        payResult === "terINSUF_FEE_B"
      ) {
        // Buyer account lacks sufficient XRP — top it up and inform the user
        logger.warn(
          { buyerAddress, payResult },
          "escrow: buyer underfunded, topping up",
        );
        await activateBuyerAccount(client, issuer, buyerAddress);
        throw new Error(
          "Votre compte manquait de XRP pour le paiement. Nous l'avons rechargé automatiquement — veuillez relancer la transaction.",
        );
      }
      throw new Error(`Buyer payment rejected by ledger: ${payResult}`);
    }
    await waitForTransaction(client, payHash!);

    // 2 — Create EscrowCreate from issuer (backend-signed, includes FinishFunction WASM)
    const { sequence, medianFee, lastLedger } = await autofillBase(
      client,
      issuer.address,
    );
    const txBlocks = Math.ceil((wasmHex.length / 2 + 200) / 512);
    const txFee = String(Math.max(medianFee * txBlocks, 50000));
    const cancelAfter = Math.floor(Date.now() / 1000) - 946684800 + 7200; // 2h

    const escrowTx: Record<string, unknown> = {
      TransactionType: "EscrowCreate",
      Account: issuer.address,
      Destination: sellerAddress,
      Amount: String(Math.round(amountXrp * 1_000_000)),
      CancelAfter: cancelAfter,
      FinishFunction: wasmHex,
      Flags: 0,
      Sequence: sequence,
      LastLedgerSequence: lastLedger,
      Fee: txFee,
      NetworkID: NETWORK_ID,
      // Memo records the buyer address on-chain
      Memos: [
        { Memo: { MemoType: toHex("BUYER"), MemoData: toHex(buyerAddress) } },
        { Memo: { MemoType: toHex("NFT_ID"), MemoData: nftId.toUpperCase() } },
      ],
    };

    const { tx_blob, hash } = signCustomTx(escrowTx, issuer);
    const { ok: escrowOk } = await submitAndCheck(
      client,
      tx_blob,
      "EscrowCreate",
    );
    if (!escrowOk) throw new Error("EscrowCreate rejected by ledger");

    await waitForTransaction(client, hash);
    logger.info(
      { escrowSequence: sequence, hash, escrowAccount: issuer.address },
      "escrow: created",
    );

    return {
      escrowSequence: sequence,
      hash,
      escrowAccount: issuer.address,
      buyerAddress,
      cancelAfter,
    };
  } finally {
    await client.disconnect();
  }
}

export interface FinishEscrowParams {
  escrowSequence: number;
  nftId: string;
  buyerAddress: string;
}

export interface FinishEscrowResult {
  hash: string;
}

async function waitForNFTInWallet(
  client: Client,
  address: string,
  nftId: string,
  timeoutMs = ESCROW_FINISH_NFT_WAIT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const normalizedId = nftId.toUpperCase();
  let delay = 2000;
  while (Date.now() < deadline) {
    const response = await client.request({
      command: "account_nfts",
      account: address,
      ledger_index: "validated",
    });
    const nfts = (response.result as Record<string, unknown>)[
      "account_nfts"
    ] as Record<string, unknown>[];
    if (
      nfts.some(
        (n) => (n["NFTokenID"] as string).toUpperCase() === normalizedId,
      )
    )
      return;
    await sleep(delay);
    delay = Math.min(delay * 1.5, 10000);
  }
  throw new Error(
    `NFT ${nftId} not found in buyer wallet ${address} after ${timeoutMs / 1000}s — NFT transfer may not be validated yet`,
  );
}

export async function finishEscrow(
  params: FinishEscrowParams,
): Promise<FinishEscrowResult> {
  const { escrowSequence, nftId, buyerAddress } = params;
  const notaire = getOracleWallet();

  // The escrow Account is the issuer (notaire) — same wallet
  logger.info(
    { escrowAccount: notaire.address, escrowSequence, nftId, buyerAddress },
    "escrow: finishing",
  );

  // Both notaire and oracle sign the NFT ID (same key — dual-signature memos for WASM)
  const msgHex = nftId.toLowerCase();
  const notaireSigHex = keypairs.sign(msgHex, notaire.privateKey);
  const notairePubHex = notaire.publicKey;
  const oracleSigHex = notaireSigHex;
  const oraclePubHex = notairePubHex;

  const client = new Client(ENDPOINT);
  await client.connect();

  try {
    // Wait until the NFT appears in the buyer's validated ledger state before
    // submitting EscrowFinish — the WASM checks this live on-chain
    logger.info(
      { buyerAddress, nftId },
      "escrow: waiting for NFT to appear in buyer wallet",
    );
    await waitForNFTInWallet(client, buyerAddress, nftId);
    logger.info(
      { buyerAddress, nftId },
      "escrow: NFT confirmed in buyer wallet",
    );

    const { sequence, lastLedger } = await autofillBase(
      client,
      notaire.address,
    );

    // Encode buyer address as 20-byte AccountID for WASM Memo[5]
    const buyerAccountIdHex = Buffer.from(decodeAccountID(buyerAddress))
      .toString("hex")
      .toUpperCase();

    const tx: Record<string, unknown> = {
      TransactionType: "EscrowFinish",
      Account: notaire.address,
      Owner: notaire.address, // issuer created the escrow, so Owner = issuer
      OfferSequence: escrowSequence,
      Flags: 0,
      Sequence: sequence,
      LastLedgerSequence: lastLedger,
      Fee: "2000000",
      ComputationAllowance: 1000000,
      NetworkID: NETWORK_ID,
      Memos: [
        { Memo: { MemoType: toHex("NFT_ID"), MemoData: nftId.toUpperCase() } },
        {
          Memo: {
            MemoType: toHex("NOTARY_SIG"),
            MemoData: notaireSigHex.toUpperCase(),
          },
        },
        {
          Memo: {
            MemoType: toHex("NOTARY_PUBKEY"),
            MemoData: notairePubHex.toUpperCase(),
          },
        },
        {
          Memo: {
            MemoType: toHex("ORACLE_SIG"),
            MemoData: oracleSigHex.toUpperCase(),
          },
        },
        {
          Memo: {
            MemoType: toHex("ORACLE_PUBKEY"),
            MemoData: oraclePubHex.toUpperCase(),
          },
        },
        {
          Memo: { MemoType: toHex("BUYER_ADDR"), MemoData: buyerAccountIdHex },
        },
      ],
    };

    const { tx_blob, hash } = signCustomTx(tx, notaire);
    const { ok } = await submitAndCheck(client, tx_blob, "EscrowFinish");
    if (!ok) throw new Error("EscrowFinish rejected by ledger");

    await waitForTransaction(client, hash);
    logger.info({ hash }, "escrow: finished");

    return { hash };
  } finally {
    await client.disconnect();
  }
}

export async function getPendingEscrows(
  address: string,
): Promise<Record<string, unknown>[]> {
  const client = new Client(ENDPOINT);
  await client.connect();
  try {
    const response = await client.request({
      command: "account_objects",
      account: address,
      type: "escrow",
      ledger_index: "validated",
    });
    return (response.result.account_objects ?? []) as Record<string, unknown>[];
  } catch (err) {
    logger.error({ err, address }, "escrow: failed to fetch pending escrows");
    return [];
  } finally {
    await client.disconnect();
  }
}

/**
 * Returns all on-chain escrows created by the notary/issuer that belong to a given buyer.
 *
 * Strategy: Memos are stored on transactions, not on Escrow ledger objects.
 * So we scan the issuer's EscrowCreate transaction history via account_tx,
 * find those with a matching BUYER memo, then verify each escrow is still
 * live on-chain via ledger_entry.
 */
export async function getEscrowsByBuyer(
  buyerAddress: string,
): Promise<Record<string, unknown>[]> {
  const issuer = getOracleWallet();
  const buyerMemoType = toHex("BUYER").toUpperCase();
  const buyerMemoData = toHex(buyerAddress).toUpperCase();

  const client = new Client(ENDPOINT);
  await client.connect();
  try {
    // 1 — Find all EscrowCreate transactions from the issuer with a matching BUYER memo
    const txResponse = await client.request({
      command: "account_tx",
      account: issuer.address,
      ledger_index_min: -1,
      ledger_index_max: -1,
      limit: 200,
      forward: false,
    });

    const transactions =
      ((txResponse.result as Record<string, unknown>)["transactions"] as Record<
        string,
        unknown
      >[]) ?? [];

    const nftIdMemoType = toHex("NFT_ID").toUpperCase();
    const matchingEscrows: Array<{ seq: number; nftId: string | null }> = [];

    for (const entry of transactions) {
      const tx = (entry["tx"] ?? entry["tx_json"]) as
        | Record<string, unknown>
        | undefined;
      if (!tx) continue;
      if (tx["TransactionType"] !== "EscrowCreate") continue;

      const memos = tx["Memos"] as
        | Array<{ Memo: { MemoType?: string; MemoData?: string } }>
        | undefined;
      if (!memos) continue;

      const hasBuyer = memos.some(
        (m) =>
          m.Memo.MemoType?.toUpperCase() === buyerMemoType &&
          m.Memo.MemoData?.toUpperCase() === buyerMemoData,
      );
      if (!hasBuyer) continue;

      const nftIdMemo = memos.find(
        (m) => m.Memo.MemoType?.toUpperCase() === nftIdMemoType,
      );
      const nftId = nftIdMemo?.Memo.MemoData?.toUpperCase() ?? null;
      matchingEscrows.push({ seq: tx["Sequence"] as number, nftId });
    }

    if (matchingEscrows.length === 0) return [];

    // 2 — For each matching sequence, fetch the live escrow object (may no longer exist if finished/cancelled)
    const results: Record<string, unknown>[] = [];
    for (const { seq, nftId } of matchingEscrows) {
      try {
        const entry = await client.request({
          command: "ledger_entry",
          escrow: { owner: issuer.address, seq },
          ledger_index: "validated",
        });
        const node = (entry.result as Record<string, unknown>)[
          "node"
        ] as Record<string, unknown>;
        if (node) results.push({ ...node, NftId: nftId });
      } catch (_) {
        // Escrow already finished or cancelled — skip
      }
    }

    return results;
  } catch (err) {
    logger.error({ err }, "escrow: failed to fetch escrows by buyer");
    return [];
  } finally {
    await client.disconnect();
  }
}

export async function getEscrowsBySeller(
  sellerAddress: string,
): Promise<Record<string, unknown>[]> {
  const issuer = getOracleWallet();
  const client = new Client(ENDPOINT);
  await client.connect();
  try {
    // Fetch all escrow objects linked to the seller (account_objects returns entries
    // for both the Account and the Destination of an escrow).
    const response = await client.request({
      command: "account_objects",
      account: sellerAddress,
      type: "escrow",
      ledger_index: "validated",
    });
    const escrows = (response.result.account_objects ?? []) as Record<
      string,
      unknown
    >[];
    // Keep only escrows where the seller is the Destination (not the creator).
    const sellerEscrows = escrows.filter(
      (e) => e["Destination"] === sellerAddress,
    );

    if (sellerEscrows.length === 0) return [];

    // Enrich with NFT_ID and BuyerAddress by scanning the issuer's EscrowCreate transaction history.
    const nftIdBySeq = new Map<number, string>();
    const buyerAddrBySeq = new Map<number, string>();
    try {
      const txResp = await client.request({
        command: "account_tx",
        account: issuer.address,
        ledger_index_min: -1,
        ledger_index_max: -1,
        limit: 200,
        forward: false,
      });
      const transactions = ((txResp.result as Record<string, unknown>)[
        "transactions"
      ] ?? []) as Record<string, unknown>[];
      const nftIdMemoType = toHex("NFT_ID").toUpperCase();
      const buyerMemoType = toHex("BUYER").toUpperCase();
      for (const entry of transactions) {
        const tx = (entry["tx"] ?? entry["tx_json"]) as
          | Record<string, unknown>
          | undefined;
        if (!tx || tx["TransactionType"] !== "EscrowCreate") continue;
        const memos = tx["Memos"] as
          | Array<{ Memo: { MemoType?: string; MemoData?: string } }>
          | undefined;
        if (!memos) continue;
        const seq = tx["Sequence"] as number;
        const nftMemo = memos.find(
          (m) => m.Memo.MemoType?.toUpperCase() === nftIdMemoType,
        );
        if (nftMemo?.Memo.MemoData) {
          nftIdBySeq.set(seq, nftMemo.Memo.MemoData.toUpperCase());
        }
        const buyerMemo = memos.find(
          (m) => m.Memo.MemoType?.toUpperCase() === buyerMemoType,
        );
        if (buyerMemo?.Memo.MemoData) {
          buyerAddrBySeq.set(
            seq,
            Buffer.from(buyerMemo.Memo.MemoData, "hex").toString("utf8"),
          );
        }
      }
    } catch (err) {
      logger.warn({ err }, "escrow: could not enrich seller escrows with memo data");
    }

    return sellerEscrows.map((e) => ({
      ...e,
      NftId: nftIdBySeq.get(e["Sequence"] as number) ?? null,
      BuyerAddress: buyerAddrBySeq.get(e["Sequence"] as number) ?? null,
    }));
  } catch (err) {
    logger.error({ err, sellerAddress }, "escrow: failed to fetch escrows by seller");
    return [];
  } finally {
    await client.disconnect();
  }
}

interface EscrowCreateMemo {
  Memo: { MemoType?: string; MemoData?: string };
}

function decodeBuyerFromMemo(memoData?: string): string | null {
  if (!memoData) return null;
  try {
    return Buffer.from(memoData, "hex").toString("utf8");
  } catch {
    return null;
  }
}

function getTxResult(entry: Record<string, unknown>): string | null {
  const meta = entry["meta"] as Record<string, unknown> | undefined;
  const result = meta?.["TransactionResult"];
  return typeof result === "string" ? result : null;
}

export async function getSuccessfulEscrowsBySeller(
  sellerAddress: string,
): Promise<Record<string, unknown>[]> {
  const issuer = getOracleWallet();
  const client = new Client(ENDPOINT);
  await client.connect();
  try {
    const txResp = await client.request({
      command: "account_tx",
      account: issuer.address,
      ledger_index_min: -1,
      ledger_index_max: -1,
      limit: 400,
      forward: false,
    });

    const transactions = ((txResp.result as Record<string, unknown>)[
      "transactions"
    ] ?? []) as Record<string, unknown>[];

    const nftIdMemoType = toHex("NFT_ID").toUpperCase();
    const buyerMemoType = toHex("BUYER").toUpperCase();

    const createsBySeq = new Map<
      number,
      {
        escrowSequence: number;
        sellerAddress: string;
        buyerAddress: string | null;
        nftId: string | null;
        amountDrops: string;
        escrowCreateHash: string | null;
      }
    >();

    for (const entry of transactions) {
      const tx = (entry["tx"] ?? entry["tx_json"]) as
        | Record<string, unknown>
        | undefined;
      if (!tx || tx["TransactionType"] !== "EscrowCreate") continue;
      if (getTxResult(entry)?.startsWith("tes") !== true) continue;
      if (tx["Destination"] !== sellerAddress) continue;

      const seq = tx["Sequence"] as number;
      const memos = tx["Memos"] as EscrowCreateMemo[] | undefined;
      const nftMemo = memos?.find(
        (m) => m.Memo.MemoType?.toUpperCase() === nftIdMemoType,
      );
      const buyerMemo = memos?.find(
        (m) => m.Memo.MemoType?.toUpperCase() === buyerMemoType,
      );

      createsBySeq.set(seq, {
        escrowSequence: seq,
        sellerAddress,
        buyerAddress: decodeBuyerFromMemo(buyerMemo?.Memo.MemoData),
        nftId: nftMemo?.Memo.MemoData?.toUpperCase() ?? null,
        amountDrops: String(tx["Amount"] ?? "0"),
        escrowCreateHash: typeof tx["hash"] === "string" ? tx["hash"] : null,
      });
    }

    if (createsBySeq.size === 0) return [];

    const successful: Array<Record<string, unknown>> = [];
    for (const entry of transactions) {
      const tx = (entry["tx"] ?? entry["tx_json"]) as
        | Record<string, unknown>
        | undefined;
      if (!tx || tx["TransactionType"] !== "EscrowFinish") continue;
      if (getTxResult(entry)?.startsWith("tes") !== true) continue;

      const offerSequence = tx["OfferSequence"] as number | undefined;
      if (typeof offerSequence !== "number") continue;
      const create = createsBySeq.get(offerSequence);
      if (!create) continue;

      successful.push({
        ...create,
        escrowFinishHash: typeof tx["hash"] === "string" ? tx["hash"] : null,
        finishedLedgerIndex: entry["ledger_index"] ?? null,
        finishedAt:
          typeof entry["close_time_iso"] === "string"
            ? entry["close_time_iso"]
            : null,
      });
    }

    return successful;
  } catch (_) {
    return [];
  } finally {
    await client.disconnect();
  }
}

export async function prepareEscrowCancel(
  cancellerAddress: string,
  ownerAddress: string,
  offerSequence: number,
): Promise<Record<string, unknown>> {
  const client = new Client(ENDPOINT);
  await client.connect();
  try {
    const { sequence, medianFee, lastLedger } = await autofillBase(
      client,
      cancellerAddress,
    );
    return {
      TransactionType: "EscrowCancel",
      Account: cancellerAddress,
      Owner: ownerAddress,
      OfferSequence: offerSequence,
      Sequence: sequence,
      LastLedgerSequence: lastLedger,
      Fee: String(Math.max(medianFee, 12)),
      NetworkID: NETWORK_ID,
    };
  } finally {
    await client.disconnect();
  }
}
