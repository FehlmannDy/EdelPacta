const BASE = `${import.meta.env.VITE_API_BASE_URL ?? ""}/api/nft`;

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

export interface SubmitResult {
  txHash: string;
  result: string;
}

export interface IncomingOffer {
  offerId: string;
  nftokenId: string;
  owner: string;
  amount: string;
  expiration: number | null;
}

export interface NFTOffer {
  offerId: string;
  nftokenId: string;
  owner: string;
  amount: string;
  destination: string | null;
  expiration: number | null;
  sequence?: number;
}

export const nftApi = {
  prepareAcceptOffer: (params: { account: string; offerId: string }) =>
    post<Record<string, unknown>>("/prepare/accept-offer", params),

  submit: (txBlob: string) =>
    post<SubmitResult>("/submit", { txBlob }),

  incomingOffersForAccount: (address: string) =>
    get<{ offers: IncomingOffer[] }>(`/offers/incoming-for-account/${address}`)
      .then((r) => r.offers),

  incomingOffersForNft: (buyerAddress: string, nftokenId: string) =>
    get<{ offers: NFTOffer[] }>(`/offers/incoming/${buyerAddress}/${nftokenId}`)
      .then((r) => r.offers),

  getOffer: (offerId: string) =>
    get<{ offerId: string; sequence: number; nftokenId: string; destination: string | null }>(`/offer/${offerId}`),
};
