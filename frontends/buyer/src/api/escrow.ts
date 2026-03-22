const BASE = `${import.meta.env.VITE_API_BASE_URL ?? ""}/api/escrow`;

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed: ${res.status}`);
  return data as T;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed: ${res.status}`);
  return data as T;
}

export interface CreateEscrowResult {
  escrowSequence: number;
  hash: string;
  escrowAccount: string;
  buyerAddress: string;
  cancelAfter: number;
}

export interface FinishEscrowResult {
  hash: string;
}

export interface AcceptNftResult {
  txHash: string;
  account: string;
}

export interface EscrowObject {
  Account: string;
  Destination: string;
  Amount: string;
  Sequence: number;
  [key: string]: unknown;
}

export interface NftItem {
  nftokenId: string;
  uri: string | null;
}

export const escrowApi = {
  preparePayment: (params: { buyerAddress: string; amountRlusd: number }) =>
    post<{ tx: Record<string, unknown> }>("/prepare-payment", params),

  create: (params: {
    paymentTxBlob: string;
    buyerAddress: string;
    sellerAddress: string;
    nftId: string;
    amountRlusd: number;
  }) => post<CreateEscrowResult>("/create", params),

  finish: (params: { escrowSequence: number; nftId: string; offerSequence: number }) =>
    post<FinishEscrowResult>("/finish", params),

  pending: (address: string) =>
    get<{ escrows: EscrowObject[] }>(`/pending/${address}`),

  nfts: (address: string) =>
    get<{ nfts: NftItem[] }>(`/nfts/${address}`),
};
