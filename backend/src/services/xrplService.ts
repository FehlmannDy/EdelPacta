import {
  Client,
  Wallet,
  NFTokenMint,
  NFTokenBurn,
  NFTokenCreateOffer,
  NFTokenAcceptOffer,
  convertStringToHex,
} from "xrpl";

const DEFAULT_NETWORK = process.env.XRPL_NETWORK ?? "wss://wasm.devnet.rippletest.net:51233";

// XLS-20 NFTokenMint flags
export const NFTokenMintFlags = {
  tfBurnable: 0x00000001,     // Issuer can burn the NFT
  tfOnlyXRP: 0x00000002,      // NFT can only be traded for XRP
  tfTransferable: 0x00000008, // NFT can be transferred to third parties (required for TransferFee)
  tfMutable: 0x00000010,      // URI can be updated via NFTokenModify
} as const;

export interface MintNFTParams {
  /** Wallet seed (family seed or mnemonic) */
  seed: string;
  /** URI pointing to the NFT metadata (e.g. IPFS link). Max 256 bytes. */
  uri?: string;
  /** Arbitrary taxon to classify or group NFTs (uint32) */
  taxon: number;
  /**
   * Transfer fee in basis points (0–50000, where 50000 = 50%).
   * Only relevant when tfTransferable flag is set.
   */
  transferFee?: number;
  /** Bitfield of NFTokenMint flags */
  flags?: number;
  /** XRPL network WebSocket URL. Defaults to XRPL Testnet. */
  networkUrl?: string;
}

export interface MintNFTResult {
  nftokenId: string;
  txHash: string;
  account: string;
}

export async function mintNFT(params: MintNFTParams): Promise<MintNFTResult> {
  const {
    seed,
    uri,
    taxon,
    transferFee = 0,
    flags = NFTokenMintFlags.tfTransferable,
    networkUrl = DEFAULT_NETWORK,
  } = params;

  const client = new Client(networkUrl);
  await client.connect();

  try {
    const wallet = Wallet.fromSeed(seed);

    const mintTx: NFTokenMint = {
      TransactionType: "NFTokenMint",
      Account: wallet.address,
      NFTokenTaxon: taxon,
      Flags: flags,
      TransferFee: transferFee,
      ...(uri && { URI: convertStringToHex(uri) }),
    };

    const prepared = await client.autofill(mintTx);
    const signed = wallet.sign(prepared);
    const result = await client.submitAndWait(signed.tx_blob);

    if (result.result.meta === undefined || typeof result.result.meta === "string") {
      throw new Error("Unexpected transaction metadata format");
    }

    const meta = result.result.meta as { nftoken_id?: string; TransactionResult: string };

    if (meta.TransactionResult !== "tesSUCCESS") {
      throw new Error(`Transaction failed: ${meta.TransactionResult}`);
    }

    // nftoken_id is returned directly in metadata by some nodes
    // Fallback: parse AffectedNodes for the minted token ID
    const nftokenId = meta.nftoken_id ?? extractNFTokenId(result.result.meta);

    if (!nftokenId) {
      throw new Error("Could not retrieve NFTokenID from transaction result");
    }

    return {
      nftokenId,
      txHash: signed.hash,
      account: wallet.address,
    };
  } finally {
    await client.disconnect();
  }
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

export interface NFToken {
  nftokenId: string;
  issuer: string;
  taxon: number;
  transferFee: number;
  flags: number;
  uri: string | null;
}

export interface NFTOffer {
  offerId: string;
  nftokenId: string;
  owner: string;
  amount: string;
  destination: string | null;
  expiration: number | null;
  isSellOffer: boolean;
}

export async function getIncomingOffers(address: string, nftokenId: string, networkUrl = DEFAULT_NETWORK): Promise<NFTOffer[]> {
  const client = new Client(networkUrl);
  await client.connect();

  try {
    const response = await client.request({
      command: "nft_sell_offers",
      nft_id: nftokenId,
    });

    const offers = (response.result.offers ?? []) as Record<string, unknown>[];

    // Keep offers with no destination (open) or destination = this address
    return offers
      .filter((o) => !o["destination"] || o["destination"] === address)
      .map((o) => ({
        offerId: o["nft_offer_index"] as string,
        nftokenId,
        owner: o["owner"] as string,
        amount: String(o["amount"] ?? "0"),
        destination: (o["destination"] as string) ?? null,
        expiration: (o["expiration"] as number) ?? null,
        isSellOffer: true,
      }));
  } catch (err: unknown) {
    // objectNotFound means no offers exist for this NFToken
    if (err && typeof err === "object" && (err as Record<string, unknown>)["data"] &&
        ((err as Record<string, unknown>)["data"] as Record<string, unknown>)["error"] === "objectNotFound") {
      return [];
    }
    throw err;
  } finally {
    await client.disconnect();
  }
}

export interface PendingOffer {
  offerId: string;
  nftokenId: string;
  destination: string | null;
  amount: string;
  expiration: number | null;
  isSellOffer: boolean;
}

export interface IncomingOffer {
  offerId: string;
  nftokenId: string;
  owner: string;
  amount: string;
  expiration: number | null;
}

/** Derive an XRPL address from a family seed without connecting to the network. */
export function deriveAddress(seed: string): string {
  return Wallet.fromSeed(seed).address;
}

function isObjectNotFound(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const data = (err as Record<string, unknown>)["data"];
  if (!data || typeof data !== "object") return false;
  return (data as Record<string, unknown>)["error"] === "objectNotFound";
}

/**
 * Find all sell offers targeted at `destination` by scanning every NFT
 * ever minted by `minterAddress`.
 *
 * Strategy (no native XRPL index for offers-by-destination):
 *   1. account_tx(minter, NFTokenMint) → ALL NFT IDs ever minted (paginated)
 *      Using account_tx instead of account_nfts because account_nfts only
 *      returns NFTs currently held — misses transferred ones that may still
 *      have pending offers.
 *   2. nft_sell_offers(nftId)          → all sell offers per NFT (single client)
 *   3. filter client-side              → keep only offers where destination === us
 */
export async function getIncomingOffersForAccount(
  destination: string,
  minterAddress: string,
  networkUrl = DEFAULT_NETWORK
): Promise<IncomingOffer[]> {
  const client = new Client(networkUrl);
  await client.connect();

  try {
    // Step 1: crawl account_tx to collect ALL NFT IDs ever minted
    const mintedNftIds = new Set<string>();
    let marker: unknown = undefined;

    do {
      const txResp = await client.request({
        command: "account_tx",
        account: minterAddress,
        ledger_index_min: -1,
        ledger_index_max: -1,
        limit: 200,
        ...(marker ? { marker } : {}),
      });

      const transactions = (txResp.result.transactions ?? []) as Record<string, unknown>[];

      for (const entry of transactions) {
        // xrpl.js v2 uses "tx" + "meta", v3 uses "tx_json" + "metadata"
        const tx = (entry["tx"] ?? entry["tx_json"]) as Record<string, unknown> | undefined;
        const meta = (entry["meta"] ?? entry["metadata"]) as Record<string, unknown> | undefined;

        if (tx?.["TransactionType"] !== "NFTokenMint") continue;
        if ((meta?.["TransactionResult"] as string) !== "tesSUCCESS") continue;

        const nftId = (meta?.["nftoken_id"] as string) ?? extractNFTokenId(meta);
        if (nftId) mintedNftIds.add(nftId);
      }

      marker = txResp.result.marker;
    } while (marker);

    // Step 2 + 3: for each minted NFT, fetch sell offers and filter by destination
    const results: IncomingOffer[] = [];

    for (const nftId of mintedNftIds) {
      try {
        const offersResp = await client.request({
          command: "nft_sell_offers",
          nft_id: nftId,
        });

        const offers = (offersResp.result.offers ?? []) as Record<string, unknown>[];
        for (const o of offers) {
          if (o["destination"] === destination) {
            results.push({
              offerId: o["nft_offer_index"] as string,
              nftokenId: nftId,
              owner: o["owner"] as string,
              amount: String(o["amount"] ?? "0"),
              expiration: (o["expiration"] as number) ?? null,
            });
          }
        }
      } catch (err: unknown) {
        if (isObjectNotFound(err)) continue;
        throw err;
      }
    }

    return results;
  } finally {
    await client.disconnect();
  }
}

export async function getOutgoingOffers(account: string, networkUrl = DEFAULT_NETWORK): Promise<PendingOffer[]> {
  const client = new Client(networkUrl);
  await client.connect();

  try {
    const response = await client.request({
      command: "account_objects",
      account,
      type: "nft_offer",
      ledger_index: "validated",
    });

    const objects = (response.result.account_objects ?? []) as Record<string, unknown>[];
    return objects
      .filter((o) => o["Owner"] === account)
      .map((o) => ({
        offerId: o["index"] as string,
        nftokenId: o["NFTokenID"] as string,
        destination: (o["Destination"] as string) ?? null,
        amount: String(o["Amount"] ?? "0"),
        expiration: (o["Expiration"] as number) ?? null,
        isSellOffer: !!((o["Flags"] as number) & 1),
      }));
  } finally {
    await client.disconnect();
  }
}

export async function getAccountNFTs(account: string, networkUrl = DEFAULT_NETWORK): Promise<NFToken[]> {
  const client = new Client(networkUrl);
  await client.connect();

  try {
    const response = await client.request({
      command: "account_nfts",
      account,
      ledger_index: "validated",
    });

    return (response.result.account_nfts ?? []).map((nft: Record<string, unknown>) => ({
      nftokenId: nft["NFTokenID"] as string,
      issuer: nft["Issuer"] as string,
      taxon: nft["NFTokenTaxon"] as number,
      transferFee: (nft["TransferFee"] as number) ?? 0,
      flags: (nft["Flags"] as number) ?? 0,
      uri: nft["URI"] ? Buffer.from(nft["URI"] as string, "hex").toString("utf8") : null,
    }));
  } finally {
    await client.disconnect();
  }
}

// ---------------------------------------------------------------------------
// Prepare (unsigned) + Submit (signed blob) — for frontend wallet signing
// ---------------------------------------------------------------------------

export interface PrepareMintParams {
  account: string;
  taxon: number;
  uri?: string;
  transferFee?: number;
  flags?: number;
  networkUrl?: string;
}

export async function prepareMintTx(params: PrepareMintParams): Promise<Record<string, unknown>> {
  const { account, taxon, uri, transferFee = 0, flags = NFTokenMintFlags.tfTransferable, networkUrl = DEFAULT_NETWORK } = params;

  const client = new Client(networkUrl);
  await client.connect();

  try {
    const tx: NFTokenMint = {
      TransactionType: "NFTokenMint",
      Account: account,
      NFTokenTaxon: taxon,
      Flags: flags,
      TransferFee: transferFee,
      ...(uri && { URI: convertStringToHex(uri) }),
    };
    return await client.autofill(tx) as unknown as Record<string, unknown>;
  } finally {
    await client.disconnect();
  }
}

export interface PrepareBurnParams {
  account: string;
  nftokenId: string;
  networkUrl?: string;
}

export async function prepareBurnTx(params: PrepareBurnParams): Promise<Record<string, unknown>> {
  const { account, nftokenId, networkUrl = DEFAULT_NETWORK } = params;

  const client = new Client(networkUrl);
  await client.connect();

  try {
    const tx: NFTokenBurn = {
      TransactionType: "NFTokenBurn",
      Account: account,
      NFTokenID: nftokenId,
    };
    return await client.autofill(tx) as unknown as Record<string, unknown>;
  } finally {
    await client.disconnect();
  }
}

export interface PrepareTransferOfferParams {
  account: string;
  nftokenId: string;
  destination?: string;
  amount?: string;
  networkUrl?: string;
}

export async function prepareTransferOfferTx(params: PrepareTransferOfferParams): Promise<Record<string, unknown>> {
  const { account, nftokenId, destination, amount = "0", networkUrl = DEFAULT_NETWORK } = params;

  const client = new Client(networkUrl);
  await client.connect();

  try {
    const tx: NFTokenCreateOffer = {
      TransactionType: "NFTokenCreateOffer",
      Account: account,
      NFTokenID: nftokenId,
      Amount: amount,
      Flags: 1,
      ...(destination && { Destination: destination }),
    };
    return await client.autofill(tx) as unknown as Record<string, unknown>;
  } finally {
    await client.disconnect();
  }
}

export interface PrepareAcceptOfferParams {
  account: string;
  offerId: string;
  networkUrl?: string;
}

export async function prepareAcceptOfferTx(params: PrepareAcceptOfferParams): Promise<Record<string, unknown>> {
  const { account, offerId, networkUrl = DEFAULT_NETWORK } = params;

  const client = new Client(networkUrl);
  await client.connect();

  try {
    const tx: NFTokenAcceptOffer = {
      TransactionType: "NFTokenAcceptOffer",
      Account: account,
      NFTokenSellOffer: offerId,
    };
    return await client.autofill(tx) as unknown as Record<string, unknown>;
  } finally {
    await client.disconnect();
  }
}

export interface SubmitSignedTxParams {
  txBlob: string;
  networkUrl?: string;
}

export interface SubmitSignedTxResult {
  txHash: string;
  result: string;
  nftokenId?: string;
  offerId?: string;
}

export async function submitSignedTx(params: SubmitSignedTxParams): Promise<SubmitSignedTxResult> {
  const { txBlob, networkUrl = DEFAULT_NETWORK } = params;

  const client = new Client(networkUrl);
  await client.connect();

  try {
    const response = await client.submitAndWait(txBlob);
    const meta = response.result.meta as Record<string, unknown> | undefined;

    if (!meta || typeof meta === "string") {
      throw new Error("Unexpected transaction metadata format");
    }

    const txResult = meta["TransactionResult"] as string;
    if (txResult !== "tesSUCCESS") {
      throw new Error(`Transaction failed: ${txResult}`);
    }

    return {
      txHash: response.result.hash as string,
      result: txResult,
      nftokenId: (meta["nftoken_id"] as string | undefined) ?? extractNFTokenId(meta) ?? undefined,
      offerId: extractOfferId(meta) ?? undefined,
    };
  } finally {
    await client.disconnect();
  }
}

export interface CreateTransferOfferParams {
  /** Wallet seed of the current NFT owner */
  seed: string;
  /** NFTokenID to transfer */
  nftokenId: string;
  /**
   * Recipient address. Setting this restricts who can accept the offer,
   * which is recommended for direct transfers.
   */
  destination?: string;
  /**
   * Amount in drops of XRP (use "0" for a free/gift transfer).
   * Defaults to "0".
   */
  amount?: string;
  networkUrl?: string;
}

export interface CreateTransferOfferResult {
  offerId: string;
  txHash: string;
}

export async function createTransferOffer(
  params: CreateTransferOfferParams
): Promise<CreateTransferOfferResult> {
  const {
    seed,
    nftokenId,
    destination,
    amount = "0",
    networkUrl = DEFAULT_NETWORK,
  } = params;

  const client = new Client(networkUrl);
  await client.connect();

  try {
    const wallet = Wallet.fromSeed(seed);

    const offerTx: NFTokenCreateOffer = {
      TransactionType: "NFTokenCreateOffer",
      Account: wallet.address,
      NFTokenID: nftokenId,
      Amount: amount,
      Flags: 1, // tfSellToken
      ...(destination && { Destination: destination }),
    };

    const prepared = await client.autofill(offerTx);
    const signed = wallet.sign(prepared);
    const result = await client.submitAndWait(signed.tx_blob);

    const meta = result.result.meta as Record<string, unknown> | undefined;
    if (!meta || typeof meta === "string") {
      throw new Error("Unexpected transaction metadata format");
    }

    if (meta["TransactionResult"] !== "tesSUCCESS") {
      throw new Error(`Transaction failed: ${meta["TransactionResult"]}`);
    }

    const offerId = extractOfferId(meta);
    if (!offerId) {
      throw new Error("Could not retrieve offer ID from transaction result");
    }

    return { offerId, txHash: signed.hash };
  } finally {
    await client.disconnect();
  }
}

export interface AcceptTransferOfferParams {
  /** Wallet seed of the recipient (the one accepting the sell offer) */
  seed: string;
  /** Offer ID returned by createTransferOffer */
  offerId: string;
  networkUrl?: string;
}

export interface AcceptTransferOfferResult {
  txHash: string;
  account: string;
}

export async function acceptTransferOffer(
  params: AcceptTransferOfferParams
): Promise<AcceptTransferOfferResult> {
  const {
    seed,
    offerId,
    networkUrl = DEFAULT_NETWORK,
  } = params;

  const client = new Client(networkUrl);
  await client.connect();

  try {
    const wallet = Wallet.fromSeed(seed);

    const acceptTx: NFTokenAcceptOffer = {
      TransactionType: "NFTokenAcceptOffer",
      Account: wallet.address,
      NFTokenSellOffer: offerId,
    };

    const prepared = await client.autofill(acceptTx);
    const signed = wallet.sign(prepared);
    const result = await client.submitAndWait(signed.tx_blob);

    const meta = result.result.meta as Record<string, unknown> | undefined;
    if (!meta || typeof meta === "string") {
      throw new Error("Unexpected transaction metadata format");
    }

    if (meta["TransactionResult"] !== "tesSUCCESS") {
      throw new Error(`Transaction failed: ${meta["TransactionResult"]}`);
    }

    return { txHash: signed.hash, account: wallet.address };
  } finally {
    await client.disconnect();
  }
}

function extractOfferId(meta: unknown): string | null {
  if (!meta || typeof meta !== "object") return null;

  const affectedNodes = (meta as Record<string, unknown>)["AffectedNodes"];
  if (!Array.isArray(affectedNodes)) return null;

  for (const node of affectedNodes) {
    const created = (node as Record<string, unknown>)["CreatedNode"];
    if (!created || typeof created !== "object") continue;

    const ledgerEntryType = (created as Record<string, unknown>)["LedgerEntryType"];
    if (ledgerEntryType !== "NFTokenOffer") continue;

    const newFields = (created as Record<string, unknown>)["NewFields"];
    if (!newFields || typeof newFields !== "object") continue;

    const index = (created as Record<string, unknown>)["LedgerIndex"];
    if (index) return index as string;
  }

  return null;
}

function extractNFTokenId(meta: unknown): string | null {
  if (!meta || typeof meta !== "object") return null;

  const affectedNodes = (meta as Record<string, unknown>)["AffectedNodes"];
  if (!Array.isArray(affectedNodes)) return null;

  for (const node of affectedNodes) {
    const created = (node as Record<string, unknown>)["CreatedNode"];
    const modified = (node as Record<string, unknown>)["ModifiedNode"];
    const target = created ?? modified;

    if (!target || typeof target !== "object") continue;

    const ledgerEntryType = (target as Record<string, unknown>)["LedgerEntryType"];
    if (ledgerEntryType !== "NFTokenPage") continue;

    const finalFields =
      (target as Record<string, unknown>)["NewFields"] ??
      (target as Record<string, unknown>)["FinalFields"];

    if (!finalFields || typeof finalFields !== "object") continue;

    const nftokens = (finalFields as Record<string, unknown>)["NFTokens"];
    if (!Array.isArray(nftokens) || nftokens.length === 0) continue;

    const lastToken = nftokens[nftokens.length - 1] as Record<string, unknown>;
    const nftoken = lastToken["NFToken"] as Record<string, unknown> | undefined;
    if (nftoken?.["NFTokenID"]) {
      return nftoken["NFTokenID"] as string;
    }
  }

  return null;
}
