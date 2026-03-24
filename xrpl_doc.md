# XRPL Developer Guide — NFTs, Smart Escrows & Credentials

This guide explains how to interact with the XRP Ledger programmatically using **xrpl.js v4**. It covers NFT management, WASM-powered smart escrows, on-chain credentials, and all the surrounding patterns (connection lifecycle, signing, fee calculation, polling, encoding). All patterns are extracted from production working code.

---

## Table of Contents

1. [Setup & Connection](#1-setup--connection)
2. [Wallets & Signing](#2-wallets--signing)
3. [Transaction Autofill](#3-transaction-autofill)
4. [NFTs](#4-nfts)
   - [Minting NFTs](#41-minting-nfts)
   - [Burning NFTs](#42-burning-nfts)
   - [Creating Sell Offers](#43-creating-sell-offers)
   - [Accepting Offers](#44-accepting-offers)
   - [Cancelling Offers](#45-cancelling-offers)
   - [Querying NFTs](#46-querying-nfts)
   - [Querying Offers](#47-querying-offers)
   - [Scanning Account History for Minted NFTs](#48-scanning-account-history-for-minted-nfts)
5. [Smart Escrows with WASM Hooks](#5-smart-escrows-with-wasm-hooks)
   - [How WASM Hooks Work](#51-how-wasm-hooks-work)
   - [Custom Binary Codec Extension](#52-custom-binary-codec-extension)
   - [Signing with Custom Codec](#53-signing-with-custom-codec)
   - [Creating a Smart Escrow](#54-creating-a-smart-escrow)
   - [Finalizing a Smart Escrow](#55-finalizing-a-smart-escrow)
   - [Cancelling an Escrow](#56-cancelling-an-escrow)
   - [Querying Escrows](#57-querying-escrows)
   - [Waiting for Transaction Validation](#58-waiting-for-transaction-validation)
   - [Waiting for NFT to Appear in Wallet](#59-waiting-for-nft-to-appear-in-wallet)
6. [WASM Hook Contract (Rust)](#6-wasm-hook-contract-rust)
   - [Entry Point & Return Values](#61-entry-point--return-values)
   - [Reading Memos from a Transaction](#62-reading-memos-from-a-transaction)
   - [Checking Account Authority](#63-checking-account-authority)
   - [Checking On-Chain Credentials](#64-checking-on-chain-credentials)
   - [Checking NFT Ownership](#65-checking-nft-ownership)
   - [Verifying Secp256k1 Signatures](#66-verifying-secp256k1-signatures)
   - [Building & Deploying the Hook](#67-building--deploying-the-hook)
7. [On-Chain Credentials (KYC)](#7-on-chain-credentials-kyc)
   - [Custom Codec for Credential Transactions](#71-custom-codec-for-credential-transactions)
   - [Issuing a Credential](#72-issuing-a-credential)
   - [Accepting a Credential](#73-accepting-a-credential)
   - [Deleting a Credential](#74-deleting-a-credential)
   - [Checking Credential Status](#75-checking-credential-status)
8. [Account Management](#8-account-management)
   - [Checking Balance](#81-checking-balance)
   - [Activating an Unfunded Account](#82-activating-an-unfunded-account)
9. [Memos](#9-memos)
10. [Fee Calculation](#10-fee-calculation)
11. [XRPL Epoch Time](#11-xrpl-epoch-time)
12. [Input Validation](#12-input-validation)
13. [Error Codes Reference](#13-error-codes-reference)

---

## 1. Setup & Connection

### Install

```bash
bun add xrpl ripple-binary-codec ripple-keypairs
# or
npm install xrpl ripple-binary-codec ripple-keypairs
```

xrpl.js version used in this project: **4.6.0**

### Connection Wrapper Pattern

Always open a connection, run your operation, then close it — regardless of success or failure:

```typescript
import { Client } from "xrpl";

async function withClient<T>(
  networkUrl: string,
  fn: (client: Client) => Promise<T>
): Promise<T> {
  const client = new Client(networkUrl);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.disconnect();
  }
}

// Usage
const networkUrl = "wss://wasm.devnet.rippletest.net:51233";

const result = await withClient(networkUrl, async (client) => {
  return await client.request({ command: "account_info", account: "r..." });
});
```

**Network URLs:**
- XRPL WASM Devnet: `wss://wasm.devnet.rippletest.net:51233`
- XRPL Testnet: `wss://s.altnet.rippletest.net:51233`
- XRPL Mainnet: `wss://xrplcluster.com`

---

## 2. Wallets & Signing

### Create a Wallet from a Seed

```typescript
import { Wallet } from "xrpl";

const wallet = Wallet.fromSeed("sEd...");
// wallet.address     → "r..."
// wallet.publicKey   → "03..." (33-byte compressed secp256k1, hex)
// wallet.privateKey  → "00..." (32-byte private key, hex)
```

### Sign a Transaction

```typescript
const prepared = await client.autofill(tx);      // Fills Sequence, Fee, LastLedgerSequence
const signed   = wallet.sign(prepared);           // Returns { tx_blob, hash }
const result   = await client.submitAndWait(signed.tx_blob);
```

### Submit a Pre-Signed Transaction Blob

```typescript
// tx_blob = signed binary transaction from a browser wallet (e.g., Otsu, GemWallet)
const result = await client.submitAndWait(txBlob);
const meta   = result.result.meta as { TransactionResult: string } | string | undefined;

if (!meta || typeof meta === "string" || meta.TransactionResult !== "tesSUCCESS") {
  throw new Error(`Transaction failed: ${typeof meta === "string" ? meta : meta?.TransactionResult}`);
}
```

> **Important:** `result.result.meta` can be `undefined`, a `string` (error text), or an object. Always guard with `typeof meta === "string"` before accessing `.TransactionResult`.

---

## 3. Transaction Autofill

To fill `Sequence`, `Fee`, and `LastLedgerSequence` manually (needed when using a custom codec that bypasses `client.autofill`):

```typescript
async function autofillBase(client: Client, account: string) {
  const [accInfo, feeInfo, ledgerInfo] = await Promise.all([
    client.request({ command: "account_info", account, ledger_index: "current" }),
    client.request({ command: "fee" }),
    client.request({ command: "ledger", ledger_index: "validated" }),
  ]);

  const accountData = accInfo.result.account_data as { Sequence: number; Balance: string };

  return {
    sequence:     accountData.Sequence,
    balanceXrp:   Number(accountData.Balance) / 1_000_000,
    medianFee:    Number((feeInfo.result as any)["drops"]["median_fee"]),
    lastLedger:   ((ledgerInfo.result as any)["ledger_index"] as number) + 100,
  };
}
```

- **Sequence**: Must be the next unused sequence number for the account.
- **Fee**: In drops (1 XRP = 1,000,000 drops). Use median from the network.
- **LastLedgerSequence**: Current validated ledger + 100 gives ~400 seconds validity window.

---

## 4. NFTs

### NFToken Flags

```typescript
const NFTokenMintFlags = {
  tfBurnable:     0x00000001,  // Issuer can burn the NFT
  tfOnlyXRP:      0x00000002,  // NFT can only trade for XRP
  tfTransferable: 0x00000008,  // Third-party transfers allowed (required for TransferFee)
  tfMutable:      0x00000010,  // URI can be updated via NFTokenModify
};
```

Combine with bitwise OR: e.g., `tfTransferable | tfBurnable = 0x00000009`.

---

### 4.1 Minting NFTs

```typescript
import { NFTokenMint, convertStringToHex } from "xrpl";

const mintTx: NFTokenMint = {
  TransactionType: "NFTokenMint",
  Account:         wallet.address,
  NFTokenTaxon:    1,                              // uint32, arbitrary classification
  Flags:           NFTokenMintFlags.tfTransferable,
  TransferFee:     500,                            // 500 = 5% commission (basis points 0–50000)
  URI:             convertStringToHex("https://example.com/deed/1"),  // optional, max 256 bytes
};

const prepared = await client.autofill(mintTx);
const signed   = wallet.sign(prepared);
const result   = await client.submitAndWait(signed.tx_blob);

// Extract nftokenId from metadata
const meta       = result.result.meta as Record<string, unknown>;
const nftokenId  = (meta["nftoken_id"] as string) ?? extractNFTokenId(meta);
```

#### Extracting NFTokenID from Metadata

Some nodes return `meta.nftoken_id` directly. As a fallback, parse `AffectedNodes`:

```typescript
function extractNFTokenId(meta: unknown): string | null {
  if (!meta || typeof meta !== "object") return null;

  const nodes = (meta as any)["AffectedNodes"] as any[];
  if (!Array.isArray(nodes)) return null;

  for (const node of nodes) {
    const target = node["CreatedNode"] ?? node["ModifiedNode"];
    if (!target || target["LedgerEntryType"] !== "NFTokenPage") continue;

    const fields  = target["NewFields"] ?? target["FinalFields"];
    const tokens  = fields?.["NFTokens"];
    if (!Array.isArray(tokens) || tokens.length === 0) continue;

    const last = tokens[tokens.length - 1];
    const id   = last?.["NFToken"]?.["NFTokenID"];
    if (id) return id as string;
  }
  return null;
}
```

**Path:** `AffectedNodes[n].{CreatedNode|ModifiedNode}` where `LedgerEntryType === "NFTokenPage"` → `{NewFields|FinalFields}.NFTokens[last].NFToken.NFTokenID`

---

### 4.2 Burning NFTs

```typescript
const burnTx = {
  TransactionType: "NFTokenBurn" as const,
  Account:         wallet.address,
  NFTokenID:       "000800002...",  // 64-char hex
};

const prepared = await client.autofill(burnTx);
const signed   = wallet.sign(prepared);
await client.submitAndWait(signed.tx_blob);
```

---

### 4.3 Creating Sell Offers

```typescript
const offerTx = {
  TransactionType: "NFTokenCreateOffer" as const,
  Account:         wallet.address,
  NFTokenID:       nftokenId,
  Amount:          "0",          // "0" = gift; or XRP drops as string
  Flags:           1,            // 1 = sell offer (tfSellToken)
  Destination:     "rBuyer...", // optional: restrict who can accept
};

const prepared = await client.autofill(offerTx);
const signed   = wallet.sign(prepared);
const result   = await client.submitAndWait(signed.tx_blob);

// Extract offerId from metadata
const offerId  = extractOfferId(result.result.meta);
```

#### Extracting OfferID from Metadata

```typescript
function extractOfferId(meta: unknown): string | null {
  if (!meta || typeof meta !== "object") return null;

  const nodes = (meta as any)["AffectedNodes"] as any[];
  if (!Array.isArray(nodes)) return null;

  for (const node of nodes) {
    const created = node["CreatedNode"];
    if (created?.["LedgerEntryType"] === "NFTokenOffer") {
      return created["LedgerIndex"] as string;  // LedgerIndex IS the offerId
    }
  }
  return null;
}
```

**Path:** `AffectedNodes[n].CreatedNode` where `LedgerEntryType === "NFTokenOffer"` → `LedgerIndex`

---

### 4.4 Accepting Offers

```typescript
const acceptTx = {
  TransactionType:  "NFTokenAcceptOffer" as const,
  Account:          wallet.address,
  NFTokenSellOffer: offerId,   // The 64-char hex LedgerIndex of the sell offer
};

const prepared = await client.autofill(acceptTx);
const signed   = wallet.sign(prepared);
await client.submitAndWait(signed.tx_blob);
// NFT is now in wallet.address
```

---

### 4.5 Cancelling Offers

```typescript
const cancelTx = {
  TransactionType: "NFTokenCancelOffer" as const,
  Account:         wallet.address,
  NFTokenOffers:   ["BEEF...", "CAFE..."],  // array of offer LedgerIndex values
};

const prepared = await client.autofill(cancelTx);
const signed   = wallet.sign(prepared);
await client.submitAndWait(signed.tx_blob);
```

---

### 4.6 Querying NFTs

#### List NFTs Owned by an Account

```typescript
const response = await client.request({
  command:      "account_nfts",
  account:      address,
  ledger_index: "validated",
});

const nfts = (response.result.account_nfts ?? []).map((nft: any) => ({
  nftokenId:   nft["NFTokenID"] as string,
  issuer:      nft["Issuer"] as string,
  taxon:       nft["NFTokenTaxon"] as number,
  transferFee: (nft["TransferFee"] as number) ?? 0,
  flags:       (nft["Flags"] as number) ?? 0,
  uri:         nft["URI"] ? Buffer.from(nft["URI"] as string, "hex").toString("utf8") : null,
}));
```

- `URI` is hex-encoded on the ledger — decode with `Buffer.from(hex, "hex").toString("utf8")`.
- To encode a URI for minting: `convertStringToHex(uri)` from xrpl.js.

#### Get Offer Details by Offer ID

```typescript
const entry = await client.request({
  command:      "ledger_entry",
  index:        offerId,           // 64-char hex offer index
  ledger_index: "validated",
});

const node = (entry.result as any)["node"] as Record<string, unknown>;
// node["NFTokenID"]   → nftokenId
// node["Sequence"]    → offer sequence number
// node["Destination"] → restricted buyer (or null if open)
```

---

### 4.7 Querying Offers

#### Sell Offers for a Specific NFT

```typescript
try {
  const response = await client.request({
    command: "nft_sell_offers",
    nft_id:  nftokenId,
  });

  const offers = (response.result.offers ?? []).map((o: any) => ({
    offerId:    o["nft_offer_index"] as string,
    owner:      o["owner"] as string,
    amount:     String(o["amount"] ?? "0"),
    destination: (o["destination"] as string) ?? null,
    expiration: (o["expiration"] as number) ?? null,
    isSellOffer: true,
  }));
} catch (err: any) {
  // No offers exist for this NFT
  if (err?.data?.error === "objectNotFound") return [];
  throw err;
}
```

#### All Active Offers Created by an Account

```typescript
const response = await client.request({
  command:      "account_objects",
  account:      address,
  type:         "nft_offer",
  ledger_index: "validated",
});

const offers = (response.result.account_objects ?? [])
  .filter((o: any) => o["Owner"] === address)
  .map((o: any) => ({
    offerId:     o["index"] as string,
    nftokenId:   o["NFTokenID"] as string,
    destination: (o["Destination"] as string) ?? null,
    amount:      String(o["Amount"] ?? "0"),
    expiration:  (o["Expiration"] as number) ?? null,
    isSellOffer: !!((o["Flags"] as number) & 1),  // Flags bit 0 = sell offer
  }));
```

---

### 4.8 Scanning Account History for Minted NFTs

Useful when you need to find all NFTs ever minted by an issuer across the full ledger history:

```typescript
const mintedNftIds = new Set<string>();
let marker: unknown = undefined;
let pages = 0;
const MAX_PAGES = 50;

do {
  const txResp = await client.request({
    command:          "account_tx",
    account:          minterAddress,
    ledger_index_min: -1,
    ledger_index_max: -1,
    limit:            200,
    ...(marker ? { marker } : {}),
  });

  for (const entry of (txResp.result.transactions ?? []) as any[]) {
    // xrpl.js v2: entry.tx / entry.meta; v3: entry.tx_json / entry.metadata
    const tx   = entry["tx"]   ?? entry["tx_json"];
    const meta = entry["meta"] ?? entry["metadata"];

    if (tx?.["TransactionType"] !== "NFTokenMint") continue;
    if (meta?.["TransactionResult"] !== "tesSUCCESS") continue;

    const nftId = (meta?.["nftoken_id"] as string) ?? extractNFTokenId(meta);
    if (nftId) mintedNftIds.add(nftId);
  }

  marker = txResp.result.marker;
  pages++;
} while (marker && pages < MAX_PAGES);
```

**Pagination:** After each request, check `result.marker`. If present, pass it as `{ marker }` in the next request. Loop until `marker` is undefined.

---

## 5. Smart Escrows with WASM Hooks

### 5.1 How WASM Hooks Work

A **WASM Hook** is a WebAssembly program embedded directly inside an `EscrowCreate` transaction as the `FinishFunction` field. When someone later submits an `EscrowFinish`, the XRPL network executes the WASM program on-chain. If the WASM returns `1`, the escrow settles (funds move). If it returns `0`, the escrow stays locked.

This enables programmable escrow conditions enforced by consensus — no trusted third party needed.

**Two custom transaction fields** are required (not in the standard XRPL codec):
- `FinishFunction` (Blob) — the compiled WASM bytecode
- `ComputationAllowance` (UInt32) — maximum WASM execution budget (use `1000000`)

These fields require extending `ripple-binary-codec` with custom definitions.

---

### 5.2 Custom Binary Codec Extension

```typescript
import {
  XrplDefinitions,
  encode,
  encodeForSigning,
} from "ripple-binary-codec";
import * as rawDefs from "ripple-binary-codec/dist/enums/definitions.json";

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
    ["FinishFunction", {
      nth: 32, isVLEncoded: true, isSerialized: true, isSigningField: true, type: "Blob",
    }],
    ["ComputationAllowance", {
      nth: 72, isVLEncoded: false, isSerialized: true, isSigningField: true, type: "UInt32",
    }],
    ["Subject", {
      nth: 24, isVLEncoded: true, isSerialized: true, isSigningField: true, type: "AccountID",
    }],
    ["CredentialType", {
      nth: 31, isVLEncoded: true, isSerialized: true, isSigningField: true, type: "Blob",
    }],
    ["URI", {
      nth: 5, isVLEncoded: true, isSerialized: true, isSigningField: true, type: "Blob",
    }],
  ],
});
```

> This codec definition must be created **once** and reused for all signing operations involving these custom fields.

---

### 5.3 Signing with Custom Codec

When a transaction contains `FinishFunction` or `ComputationAllowance`, you cannot use `wallet.sign()` — it does not know about custom fields. Use this manual signing function instead:

```typescript
import { createHash } from "crypto";
import * as keypairs from "ripple-keypairs";
import { Wallet } from "xrpl";

function signCustomTx(
  txObj: Record<string, unknown>,
  wallet: Wallet,
): { tx_blob: string; hash: string } {
  const txForSigning = { ...txObj, SigningPubKey: wallet.publicKey };

  // 1. Encode the transaction for signing (deterministic canonical form)
  const signingHex = encodeForSigning(txForSigning, customDefs);

  // 2. Sign with secp256k1
  const sig = keypairs.sign(signingHex, wallet.privateKey);

  // 3. Encode the full signed transaction
  const tx_blob = encode({ ...txForSigning, TxnSignature: sig }, customDefs);

  // 4. Compute the transaction hash: SHA-512 of prefix + tx_blob, take first 32 bytes
  const hash = createHash("sha512")
    .update(Buffer.from("54584E00" + tx_blob, "hex"))
    .digest()
    .slice(0, 32)
    .toString("hex")
    .toUpperCase();

  return { tx_blob, hash };
}
```

---

### 5.4 Creating a Smart Escrow

**Full flow:**
1. Buyer sends a Payment to the backend/issuer wallet (to fund the escrow).
2. Backend creates an `EscrowCreate` with the WASM `FinishFunction` embedded.

#### Step 1 — Prepare unsigned Payment for Buyer

```typescript
import { readFileSync } from "fs";

const WASM_PATH     = "./my_contract_devnet.wasm";
const NETWORK_ID    = 2002;  // XRPL WASM devnet

async function preparePayment(buyerAddress: string, amountXrp: number) {
  return await withClient(networkUrl, async (client) => {
    const { sequence, medianFee, lastLedger, balanceXrp } = await autofillBase(client, buyerAddress);

    // Each 500-byte WASM block requires 1 owner reserve unit
    const serverInfo       = await client.request({ command: "server_info" });
    const reserveIncXrp    = (serverInfo.result as any)["info"]["validated_ledger"]["reserve_inc_xrp"] as number;
    const wasmBytes        = readFileSync(WASM_PATH).length;
    const reserveBlocks    = Math.ceil(wasmBytes / 500);
    const reserveOverhead  = reserveBlocks * reserveIncXrp;
    const totalDrops       = Math.round((amountXrp + reserveOverhead) * 1_000_000);

    return {
      tx: {
        TransactionType:    "Payment",
        Account:            buyerAddress,
        Destination:        issuerWallet.address,
        Amount:             String(totalDrops),
        Sequence:           sequence,
        LastLedgerSequence: lastLedger,
        Fee:                String(Math.max(medianFee, 12)),
        NetworkID:          NETWORK_ID,
      },
      reserveOverheadXrp: reserveOverhead,
      buyerBalanceXrp:    balanceXrp,
    };
  });
}
```

> Return this unsigned tx to the buyer's wallet (e.g., Otsu). They sign it and send you back the `tx_blob`.

#### Step 2 — Submit Payment & Create Escrow

```typescript
async function createEscrow(
  paymentTxBlob: string,   // Signed by buyer
  buyerAddress:  string,
  sellerAddress: string,
  nftId:         string,
  amountXrp:     number,
) {
  return await withClient(networkUrl, async (client) => {

    // Submit buyer's payment
    const payResult = await client.request({ command: "submit", tx_blob: paymentTxBlob });
    const payHash   = (payResult.result as any)["tx_json"]["hash"] as string;
    await waitForTransaction(client, payHash);

    // Load WASM
    const wasmHex = readFileSync(WASM_PATH).toString("hex").toUpperCase();

    // Fee: scale by WASM block count
    const { sequence, medianFee, lastLedger } = await autofillBase(client, issuerWallet.address);
    const txBlocks  = Math.ceil((wasmHex.length / 2 + 200) / 512);
    const txFee     = String(Math.max(medianFee * txBlocks, 50000));

    // CancelAfter: XRPL epoch = Unix - 946684800, plus 2-hour grace period
    const cancelAfter = Math.floor(Date.now() / 1000) - 946684800 + 7200;

    const escrowTx: Record<string, unknown> = {
      TransactionType:    "EscrowCreate",
      Account:            issuerWallet.address,
      Destination:        sellerAddress,
      Amount:             String(Math.round(amountXrp * 1_000_000)),
      CancelAfter:        cancelAfter,
      FinishFunction:     wasmHex,             // WASM bytecode as uppercase hex
      Flags:              0,
      Sequence:           sequence,
      LastLedgerSequence: lastLedger,
      Fee:                txFee,
      NetworkID:          NETWORK_ID,
      Memos: [
        { Memo: { MemoType: toHex("BUYER"),  MemoData: toHex(buyerAddress) } },
        { Memo: { MemoType: toHex("NFT_ID"), MemoData: nftId.toUpperCase() } },
      ],
    };

    const { tx_blob, hash } = signCustomTx(escrowTx, issuerWallet);
    await client.request({ command: "submit", tx_blob });
    await waitForTransaction(client, hash);

    return { escrowSequence: sequence, hash, cancelAfter };
  });
}

function toHex(str: string): string {
  return Buffer.from(str, "utf8").toString("hex").toUpperCase();
}
```

---

### 5.5 Finalizing a Smart Escrow

**Prerequisites:**
- The buyer must already own the NFT (transfer must be complete and validated).
- The WASM Hook checks live ledger state at execution time.

```typescript
import * as keypairs from "ripple-keypairs";
import { decodeAccountID } from "xrpl";

async function finishEscrow(
  escrowSequence: number,
  nftId:          string,
  buyerAddress:   string,
) {
  return await withClient(networkUrl, async (client) => {

    // Wait until NFT appears in buyer's validated account (up to 2 minutes)
    await waitForNFTInWallet(client, buyerAddress, nftId);

    // Sign the NFT_ID with the notary private key (secp256k1 ECDSA, DER output)
    const msgHex        = nftId.toLowerCase();
    const notaireSigHex = keypairs.sign(msgHex, notaireWallet.privateKey);  // DER signature
    const notairePubHex = notaireWallet.publicKey;                          // 33-byte compressed

    // Oracle signs same message (can be a different key for true dual-sig)
    const oracleSigHex  = keypairs.sign(msgHex, oracleWallet.privateKey);
    const oraclePubHex  = oracleWallet.publicKey;

    // Encode buyer address as 20-byte AccountID (binary, not base58)
    const buyerAccountIdHex = Buffer.from(decodeAccountID(buyerAddress))
      .toString("hex")
      .toUpperCase();

    const { sequence, lastLedger } = await autofillBase(client, notaireWallet.address);

    const finishTx: Record<string, unknown> = {
      TransactionType:    "EscrowFinish",
      Account:            notaireWallet.address,  // Must match NOTARY_ACCOUNT in WASM
      Owner:              issuerWallet.address,   // Account that created the escrow
      OfferSequence:      escrowSequence,         // Sequence of the EscrowCreate tx
      Flags:              0,
      Sequence:           sequence,
      LastLedgerSequence: lastLedger,
      Fee:                "2000000",              // 2M drops required for WASM execution
      ComputationAllowance: 1000000,              // WASM execution budget
      NetworkID:          NETWORK_ID,
      Memos: [
        // Memo[0]: NFT_ID — 32-byte token ID
        { Memo: { MemoType: toHex("NFT_ID"),       MemoData: nftId.toUpperCase() } },
        // Memo[1]: NOTARY_SIG — DER secp256k1 signature of NFT_ID
        { Memo: { MemoType: toHex("NOTARY_SIG"),   MemoData: notaireSigHex.toUpperCase() } },
        // Memo[2]: NOTARY_PUBKEY — 33-byte compressed secp256k1 public key
        { Memo: { MemoType: toHex("NOTARY_PUBKEY"), MemoData: notairePubHex.toUpperCase() } },
        // Memo[3]: ORACLE_SIG — DER secp256k1 signature of NFT_ID
        { Memo: { MemoType: toHex("ORACLE_SIG"),   MemoData: oracleSigHex.toUpperCase() } },
        // Memo[4]: ORACLE_PUBKEY — 33-byte compressed secp256k1 public key
        { Memo: { MemoType: toHex("ORACLE_PUBKEY"), MemoData: oraclePubHex.toUpperCase() } },
        // Memo[5]: BUYER_ADDR — 20-byte AccountID (NOT the base58 address string)
        { Memo: { MemoType: toHex("BUYER_ADDR"),   MemoData: buyerAccountIdHex } },
      ],
    };

    const { tx_blob, hash } = signCustomTx(finishTx, notaireWallet);
    await client.request({ command: "submit", tx_blob });
    await waitForTransaction(client, hash);
    return { hash };
  });
}
```

**Memo layout summary:**

| Index | MemoType | Content | Format |
|-------|----------|---------|--------|
| 0 | `NFT_ID` | NFToken ID | 64-char hex (32 bytes) |
| 1 | `NOTARY_SIG` | ECDSA signature of NFT_ID | DER hex (~71-72 bytes) |
| 2 | `NOTARY_PUBKEY` | Notary public key | 33-byte compressed secp256k1 hex |
| 3 | `ORACLE_SIG` | ECDSA signature of NFT_ID | DER hex (~71-72 bytes) |
| 4 | `ORACLE_PUBKEY` | Oracle public key | 33-byte compressed secp256k1 hex |
| 5 | `BUYER_ADDR` | Buyer's AccountID | 20-byte binary, hex-encoded (uppercase) |

**Critical:** `BUYER_ADDR` must be the 20-byte binary AccountID, not the base58 address string. Use `decodeAccountID(address)` from xrpl.js to convert.

---

### 5.6 Cancelling an Escrow

Can only be submitted after the `CancelAfter` timestamp has passed:

```typescript
const { sequence, medianFee, lastLedger } = await autofillBase(client, cancellerAddress);

const cancelTx: Record<string, unknown> = {
  TransactionType:    "EscrowCancel",
  Account:            cancellerAddress,   // Buyer or issuer
  Owner:              ownerAddress,       // Issuer (who created the EscrowCreate)
  OfferSequence:      escrowSequence,     // Sequence of the EscrowCreate
  Sequence:           sequence,
  LastLedgerSequence: lastLedger,
  Fee:                String(Math.max(medianFee, 12)),
  NetworkID:          NETWORK_ID,
};

// Sign with standard wallet.sign() — no custom fields needed
const prepared = { ...cancelTx };
const signed   = wallet.sign(prepared as any);
await client.submitAndWait(signed.tx_blob);
```

---

### 5.7 Querying Escrows

#### List Active Escrows for an Account

```typescript
const response = await client.request({
  command:      "account_objects",
  account:      address,
  type:         "escrow",
  ledger_index: "validated",
});

const escrows = response.result.account_objects;
// Each escrow has: Account, Destination, Amount, Sequence, CancelAfter, FinishAfter, Memos
```

#### Verify a Specific Escrow Still Exists

```typescript
try {
  const entry = await client.request({
    command:      "ledger_entry",
    escrow: {
      account:  ownerAddress,
      seq:      escrowSequence,
    },
    ledger_index: "validated",
  });
  // entry.result.node → the escrow object
} catch (err: any) {
  if (err?.data?.error === "entryNotFound") {
    // Escrow no longer exists (finished or cancelled)
  }
}
```

#### Decode Memos from an Escrow

Memo values are hex-encoded:
```typescript
const memo = escrow.Memos?.find((m: any) =>
  Buffer.from(m.Memo.MemoType, "hex").toString("utf8") === "BUYER"
);
const buyerAddress = memo
  ? Buffer.from(memo.Memo.MemoData, "hex").toString("utf8")
  : null;
```

---

### 5.8 Waiting for Transaction Validation

```typescript
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
      if ((result.result as any)["validated"] === true) return;
    } catch {
      // Transaction not yet known — keep polling
    }
    delay = Math.min(delay * 2, 8000);  // Exponential backoff, cap at 8s
  }
  throw new Error(`Transaction ${hash} not validated after ${timeoutMs / 1000}s`);
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
```

A transaction is **not final** until `validated === true`. Always wait for validation before proceeding.

---

### 5.9 Waiting for NFT to Appear in Wallet

```typescript
async function waitForNFTInWallet(
  client: Client,
  address: string,
  nftId: string,
  timeoutMs = 120000,  // 2 minutes default
): Promise<void> {
  const deadline     = Date.now() + timeoutMs;
  const normalizedId = nftId.toUpperCase();
  let delay = 2000;

  while (Date.now() < deadline) {
    const response = await client.request({
      command:      "account_nfts",
      account:      address,
      ledger_index: "validated",
    });
    const nfts = (response.result as any)["account_nfts"] as any[];

    if (nfts.some(n => (n["NFTokenID"] as string).toUpperCase() === normalizedId)) return;

    await sleep(delay);
    delay = Math.min(delay * 1.5, 10000);  // 1.5x backoff, cap at 10s
  }
  throw new Error(`NFT ${nftId} not found in wallet ${address} after ${timeoutMs / 1000}s`);
}
```

**Must be called before `finishEscrow()`** — the WASM Hook verifies live NFT ownership at execution time.

---

## 6. WASM Hook Contract (Rust)

The Hook is compiled to WASM and embedded in `EscrowCreate.FinishFunction`. It runs on-chain when `EscrowFinish` is submitted.

### 6.1 Entry Point & Return Values

```rust
#![cfg_attr(target_arch = "wasm32", no_std)]
#[cfg(not(target_arch = "wasm32"))]
extern crate std;

use xrpl_wasm_stdlib::*;

#[unsafe(no_mangle)]
pub extern "C" fn finish() -> i32 {
    // All validation logic here
    // Return 1 → allow escrow to settle
    // Return 0 → block escrow (funds stay locked)
    1
}
```

- **`1`** = EscrowFinish approved, funds move to `Destination`
- **`0`** = EscrowFinish rejected, escrow remains locked

---

### 6.2 Reading Memos from a Transaction

```rust
macro_rules! read_memo {
    ($idx:expr) => {{
        let mut buf: ContractData = [0; XRPL_CONTRACT_DATA_SIZE];
        let mut loc = Locator::new();
        loc.pack(sfield::Memos);
        loc.pack($idx);          // Memo index (0-based)
        loc.pack(sfield::MemoData);
        let rc = unsafe {
            get_tx_nested_field(
                loc.as_ptr(), loc.num_packed_bytes(),
                buf.as_mut_ptr(), buf.len()
            )
        };
        (buf, rc)  // rc = bytes read, negative = error
    }};
}

let (memo0, rc0) = read_memo!(0);  // NFT_ID     (32 bytes expected)
let (memo1, rc1) = read_memo!(1);  // NOTARY_SIG (variable DER)
let (memo2, rc2) = read_memo!(2);  // NOTARY_PUBKEY (33 bytes)
let (memo3, rc3) = read_memo!(3);  // ORACLE_SIG
let (memo4, rc4) = read_memo!(4);  // ORACLE_PUBKEY
let (memo5, rc5) = read_memo!(5);  // BUYER_ADDR (20 bytes)
```

`rc` (return code) = number of bytes read. Negative or zero means the memo was missing or too short.

---

### 6.3 Checking Account Authority

```rust
// Hardcoded notary address (compiled into WASM, not runtime configurable)
const NOTARY_ACCOUNT: [u8; 20] = r_address!("raW1qTXwu1qDaEzW1cKmMCn8Q7MuvEHTVK");

let tx = escrow_finish::get_current_escrow_finish();
match tx.get_account() {
    Ok(submitter) if submitter.0 == NOTARY_ACCOUNT => {
        // OK — authorized notary
    }
    _ => return 0,  // Block — wrong account
}
```

---

### 6.4 Checking On-Chain Credentials

```rust
const KYC_ISSUER: [u8; 20] = r_address!("raW1qTXwu1qDaEzW1cKmMCn8Q7MuvEHTVK");

// `bob` = seller's AccountID (from escrow Destination field)
match credential_keylet(&bob, &AccountID(KYC_ISSUER), b"SWIYU_KYC") {
    Ok(keylet) => {
        let slot = unsafe { cache_ledger_obj(keylet.as_ptr(), keylet.len(), 0) };
        if slot >= 0 {
            // Credential exists → KYC verified
        } else {
            return 0;  // No KYC credential → block
        }
    }
    Err(_) => return 0,
}
```

`credential_keylet(subject, issuer, credential_type_bytes)` builds a ledger key for a Credential object. `cache_ledger_obj` returns `>= 0` if the object exists in the current ledger state.

---

### 6.5 Checking NFT Ownership

```rust
// memo5 = 20-byte AccountID of buyer (from Memo[5])
if rc5 != 20 { return 0; }

let alice_bytes: [u8; 20] = memo5[0..20].try_into().unwrap_or_else(|_| return);
let alice = AccountID(alice_bytes);

// nft_token was constructed from memo0 (NFT_ID)
match nft_token.uri(&alice) {
    Ok(_) => {
        // Buyer owns the NFT
    }
    Err(_) => return 0,  // Buyer doesn't own NFT → block
}
```

`nft_token.uri(&alice)` queries live ledger state — it only succeeds if `alice` currently holds the NFT.

---

### 6.6 Verifying Secp256k1 Signatures

```rust
// nft_id_bytes = 32-byte NFT ID from Memo[0]
// memo1 = DER-encoded signature, memo2 = 33-byte compressed public key

if rc1 <= 0 || rc2 != 33 { return 0; }

let rc_check = unsafe {
    check_sig(
        nft_id_bytes.as_ptr(), nft_id_bytes.len(),  // message
        memo1.as_ptr(), rc1 as usize,               // DER signature
        memo2.as_ptr(), 33,                          // compressed public key
    )
};

if rc_check != 1 { return 0; }  // Invalid signature → block
```

`check_sig` is an XRPL host function that validates secp256k1 ECDSA. Returns `1` if valid.

---

### 6.7 Building & Deploying the Hook

**Cargo.toml:**
```toml
[package]
name    = "my-contract"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
xrpl-wasm-stdlib = { git = "https://github.com/ripple/xrpl-wasm-stdlib", branch = "main" }

[profile.release]
opt-level     = "z"      # Minimize binary size (critical for on-chain embedding)
lto           = true
codegen-units = 1
panic         = "abort"  # Required for no_std WASM
strip         = true
```

**Build (requires Rust 1.89.0):**
```bash
rustup target add wasm32v1-none
cargo +1.89.0 build --release --target wasm32v1-none
# Output: target/wasm32v1-none/release/my_contract.wasm
```

**Or via Docker:**
```bash
docker build -t my-hook .
docker run --rm -v $(pwd):/output my-hook
# Output: ./my_contract_devnet.wasm
```

**Deploy:** Upload WASM to XRPL using the [XRPL Hooks UI](https://ripple.github.io/xrpl-wasm-stdlib/ui/) or embed directly in `EscrowCreate.FinishFunction`.

---

## 7. On-Chain Credentials (KYC)

XRPL Credentials are on-chain objects used to attest identity (KYC). They require extending the binary codec with three new transaction types.

### 7.1 Custom Codec for Credential Transactions

The same `customDefs` object from [Section 5.2](#52-custom-binary-codec-extension) adds:

| Transaction | Type Code |
|-------------|-----------|
| `CredentialCreate` | 58 |
| `CredentialAccept` | 59 |
| `CredentialDelete` | 60 |

And new fields: `Subject` (AccountID, nth: 24), `CredentialType` (Blob, nth: 31), `URI` (Blob, nth: 5).

**Credential Type Encoding:**
```typescript
import { convertStringToHex } from "xrpl";

const CREDENTIAL_TYPE_KYC     = convertStringToHex("SWIYU_KYC");      // Identity
const CREDENTIAL_TYPE_KYC_TAX = convertStringToHex("SWIYU_KYC_TAX");  // Tax attestation
```

Always use the hex representation of the credential type string in transactions.

**Accepted Flag:**
```typescript
const LSF_ACCEPTED = 0x00010000;  // Bit 16: credential has been accepted by subject
```

---

### 7.2 Issuing a Credential

The issuer creates a credential targeted at a subject:

```typescript
const tx = {
  TransactionType: "CredentialCreate",
  Account:         issuerWallet.address,   // Issuer creates it
  Subject:         subjectAddress,         // Recipient's XRPL address
  CredentialType:  CREDENTIAL_TYPE_KYC,   // Hex-encoded credential type string
};

const prepared = await client.autofill(tx as any);
const signed   = issuerWallet.sign(prepared as any);
const result   = await client.submitAndWait(signed.tx_blob);

// Handle: tecNO_TARGET → subject account doesn't exist; activate first (see Section 8.2)
// Handle: tecDUPLICATE → credential already exists; treat as success (idempotent)
const meta       = result.result.meta as any;
const txResult   = meta["TransactionResult"] as string;
if (txResult !== "tesSUCCESS" && txResult !== "tecDUPLICATE") {
  throw new Error(`CredentialCreate failed: ${txResult}`);
}
```

---

### 7.3 Accepting a Credential

The subject must explicitly accept the credential on-chain. Prepare the unsigned tx and return it for the subject to sign:

```typescript
const tx = {
  TransactionType: "CredentialAccept",
  Account:         subjectAddress,          // Subject accepts
  Issuer:          issuerWallet.address,    // Who issued it
  CredentialType:  CREDENTIAL_TYPE_KYC,
};

const prepared = await client.autofill(tx as any);
// Return `prepared` as JSON for the subject's wallet to sign and submit
```

The subject signs with their wallet and submits via `POST /api/nft/submit`. Once submitted, the credential's `LSF_ACCEPTED` flag is set on the ledger.

---

### 7.4 Deleting a Credential

```typescript
const tx = {
  TransactionType: "CredentialDelete",
  Account:         issuerWallet.address,
  Subject:         subjectAddress,
  CredentialType:  CREDENTIAL_TYPE_KYC,
};

const prepared = await client.autofill(tx as any);
const signed   = issuerWallet.sign(prepared as any);
const result   = await client.submitAndWait(signed.tx_blob);

// tecNO_ENTRY → credential didn't exist; treat as success (idempotent delete)
const txResult = (result.result.meta as any)?.["TransactionResult"];
if (txResult !== "tesSUCCESS" && txResult !== "tecNO_ENTRY") {
  throw new Error(`CredentialDelete failed: ${txResult}`);
}
```

---

### 7.5 Checking Credential Status

```typescript
const LSF_ACCEPTED = 0x00010000;

async function checkCredentialStatus(
  subjectAddress: string,
  credentialType: string,   // e.g., CREDENTIAL_TYPE_KYC
  issuerAddress:  string,
): Promise<"accepted" | "pending_acceptance" | "none"> {

  return await withClient(networkUrl, async (client) => {

    // 1. Check subject's account — has subject accepted?
    const subjectRes = await client.request({
      command: "account_objects",
      account: subjectAddress,
      type:    "credential",
    });
    const subjectObjects = subjectRes.result.account_objects as any[];

    const isAccepted = subjectObjects.some(obj =>
      obj["LedgerEntryType"] === "Credential" &&
      obj["Issuer"]          === issuerAddress &&
      obj["CredentialType"]  === credentialType &&
      ((obj["Flags"] as number) & LSF_ACCEPTED) !== 0
    );
    if (isAccepted) return "accepted";

    // 2. Check issuer's account — is there a pending credential waiting for subject?
    const issuerRes = await client.request({
      command: "account_objects",
      account: issuerAddress,
      type:    "credential",
    });
    const issuerObjects = issuerRes.result.account_objects as any[];

    const isPending = issuerObjects.some(obj =>
      obj["LedgerEntryType"] === "Credential" &&
      obj["Subject"]         === subjectAddress &&
      obj["CredentialType"]  === credentialType &&
      ((obj["Flags"] as number) & LSF_ACCEPTED) === 0  // NOT yet accepted
    );
    if (isPending) return "pending_acceptance";

    return "none";
  });
}
```

| Status | Meaning |
|--------|---------|
| `"accepted"` | Credential exists in subject's `account_objects` with `LSF_ACCEPTED` set |
| `"pending_acceptance"` | Credential exists in issuer's `account_objects` without `LSF_ACCEPTED` |
| `"none"` | No credential found in either account |

---

## 8. Account Management

### 8.1 Checking Balance

```typescript
const response = await client.request({
  command:      "account_info",
  account:      address,
  ledger_index: "validated",
});

const accountData = response.result.account_data as { Balance: string };
const balanceXrp  = Number(accountData.Balance) / 1_000_000;  // drops → XRP
```

If account doesn't exist, request throws with `error: "actNotFound"`.

---

### 8.2 Activating an Unfunded Account

Accounts must hold a minimum reserve (~10 XRP on mainnet) before they can receive credentials or own objects. When a transaction fails with `tecNO_TARGET`, activate the account:

```typescript
async function activateAccount(
  client: Client,
  funderWallet: Wallet,
  targetAddress: string,
): Promise<void> {
  const payment = {
    TransactionType: "Payment",
    Account:         funderWallet.address,
    Destination:     targetAddress,
    Amount:          "40000000",  // 40 XRP in drops (leaves ~30 XRP usable)
  };
  const prepared = await client.autofill(payment as any);
  const signed   = funderWallet.sign(prepared as any);
  const result   = await client.submitAndWait(signed.tx_blob);

  const txResult = (result.result.meta as any)?.["TransactionResult"];
  if (txResult !== "tesSUCCESS") {
    throw new Error(`Account activation failed: ${txResult}`);
  }
}
```

**Usage pattern:**
```typescript
try {
  await client.submitAndWait(signedCredentialCreate.tx_blob);
} catch (err: any) {
  const txResult = err?.data?.result?.meta?.TransactionResult;
  if (txResult === "tecNO_TARGET") {
    await activateAccount(client, issuerWallet, subjectAddress);
    // Retry the original transaction
    const retry = await client.autofill(tx as any);
    await client.submitAndWait(issuerWallet.sign(retry as any).tx_blob);
  }
}
```

---

## 9. Memos

Memos are arbitrary key-value pairs attached to any XRPL transaction. Both `MemoType` and `MemoData` must be **hex-encoded**.

### Encoding Memos

```typescript
function toHex(str: string): string {
  return Buffer.from(str, "utf8").toString("hex").toUpperCase();
}

const memos = [
  { Memo: { MemoType: toHex("BUYER"),  MemoData: toHex("rBuyer123...") } },
  { Memo: { MemoType: toHex("NFT_ID"), MemoData: "000800002ABCDEF...".toUpperCase() } },
];
```

### Decoding Memos

```typescript
function decodeMemo(memos: any[], type: string): string | null {
  const typeHex = Buffer.from(type, "utf8").toString("hex").toUpperCase();
  const memo    = memos?.find((m: any) => m.Memo.MemoType?.toUpperCase() === typeHex);
  if (!memo) return null;
  return Buffer.from(memo.Memo.MemoData, "hex").toString("utf8");
}

const buyerAddress = decodeMemo(escrow.Memos, "BUYER");
const nftId        = decodeMemo(escrow.Memos, "NFT_ID");
```

### Encoding a Binary Value (e.g., AccountID)

When a memo must contain a 20-byte binary `AccountID` (as required by the WASM Hook for `BUYER_ADDR`):

```typescript
import { decodeAccountID } from "xrpl";

// Encode: base58 address → 20-byte binary → hex
const buyerAccountIdHex = Buffer.from(decodeAccountID(buyerAddress))
  .toString("hex")
  .toUpperCase();

// Decode: hex → 20-byte binary → base58 address (using xrpl's encodeAccountID)
import { encodeAccountID } from "xrpl";
const address = encodeAccountID(Buffer.from(hexValue, "hex") as any);
```

---

## 10. Fee Calculation

### Standard Transaction
```typescript
const medianFee = Number((feeInfo.result as any)["drops"]["median_fee"]);
const fee       = String(Math.max(medianFee, 12));  // minimum 12 drops
```

### EscrowCreate with WASM FinishFunction

Fee scales with the size of the embedded WASM bytecode:

```typescript
const wasmHex   = readFileSync(WASM_PATH).toString("hex");  // hex string
const txBlocks  = Math.ceil((wasmHex.length / 2 + 200) / 512);  // (wasmBytes + overhead) / 512
const escrowFee = String(Math.max(medianFee * txBlocks, 50000));  // minimum 50,000 drops
```

### EscrowFinish (executing WASM)
```typescript
const finishFee = "2000000";  // Fixed 2,000,000 drops (~0.002 XRP)
```

### Ledger Reserve for WASM
Each 500-byte block of WASM requires 1 owner reserve unit. The buyer must fund this overhead:

```typescript
const wasmBytes       = readFileSync(WASM_PATH).length;
const reserveBlocks   = Math.ceil(wasmBytes / 500);
const reserveIncXrp   = serverInfo.result.info.validated_ledger.reserve_inc_xrp;
const reserveOverhead = reserveBlocks * reserveIncXrp;
```

---

## 11. XRPL Epoch Time

XRPL uses a different epoch than Unix: **January 1, 2000** instead of January 1, 1970.

```typescript
const XRPL_EPOCH_OFFSET = 946684800;  // seconds from Unix epoch to XRPL epoch

// Unix timestamp → XRPL timestamp
function toXrplTime(unixSeconds: number): number {
  return unixSeconds - XRPL_EPOCH_OFFSET;
}

// XRPL timestamp → Unix timestamp
function fromXrplTime(xrplSeconds: number): number {
  return xrplSeconds + XRPL_EPOCH_OFFSET;
}

// CancelAfter: current time + 2 hours, in XRPL epoch seconds
const cancelAfter = Math.floor(Date.now() / 1000) - XRPL_EPOCH_OFFSET + 7200;
```

---

## 12. Input Validation

```typescript
// XRPL base58 address (starts with 'r', 25-35 chars total)
const XRPL_ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
function isValidXrplAddress(v: unknown): v is string {
  return typeof v === "string" && XRPL_ADDRESS_RE.test(v);
}

// NFTokenID: exactly 64 hex characters
const NFTOKEN_ID_RE = /^[0-9A-F]{64}$/i;
function isValidNftokenId(v: unknown): v is string {
  return typeof v === "string" && NFTOKEN_ID_RE.test(v);
}

// Positive finite number
function isPositiveFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && isFinite(v) && v > 0;
}

// Positive integer
function isPositiveInteger(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}
```

---

## 13. Error Codes Reference

| Code | Category | Meaning | Recommended Handling |
|------|----------|---------|----------------------|
| `tesSUCCESS` | Success | Transaction applied | Proceed |
| `terQUEUED` | Queued | Transaction queued for next ledger | Wait and poll |
| `tecNO_TARGET` | Error | Destination account doesn't exist | Activate with 40 XRP Payment, then retry |
| `tecDUPLICATE` | Error | Object already exists (credential) | Treat as success (idempotent) |
| `tecNO_ENTRY` | Error | Object not found (delete on non-existent) | Treat as success (idempotent delete) |
| `tecUNFUNDED_PAYMENT` | Error | Sender lacks funds | Top up account, then retry |
| `terINSUF_FEE_B` | Error | Fee too low | Recalculate fee, retry |
| `objectNotFound` | RPC Error | No offers for NFT (nft_sell_offers) | Return empty array |
| `entryNotFound` | RPC Error | Ledger object doesn't exist | Object was already consumed/deleted |
| `actNotFound` | RPC Error | Account doesn't exist | Account not yet funded |

**Checking engine result on submit:**
```typescript
const result    = await client.request({ command: "submit", tx_blob });
const engResult = (result.result as any)["engine_result"] as string;
const ok        = engResult.startsWith("tes") || engResult === "terQUEUED";
if (!ok) throw new Error(`Rejected: ${engResult}`);
```

**Checking on submitAndWait:**
```typescript
const meta     = result.result.meta;
const txResult = typeof meta === "object" ? (meta as any)["TransactionResult"] : meta;
if (txResult !== "tesSUCCESS") throw new Error(`Failed: ${txResult}`);
```
