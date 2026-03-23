const BASE = "/api/nft";

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Request failed: ${res.status}`);
  return data as T;
}

export interface PendingOffer {
  offerId: string;
  nftokenId: string;
  destination: string | null;
  amount: string;
  expiration: number | null;
  isSellOffer: boolean;
}

export interface SubmitResult {
  txHash: string;
  result: string;
}

export const nftApi = {
  submit: (txBlob: string) =>
    post<SubmitResult>("/submit", { txBlob }),

  outgoingOffers: (address: string) =>
    fetch(`/api/nft/offers/outgoing/${address}`)
      .then(async (r) => {
        const data = await r.json() as { offers?: PendingOffer[]; error?: string };
        if (!r.ok) throw new Error(data.error ?? "Failed to fetch offers");
        return data.offers ?? [];
      }),

  issuerMint: (params: { taxon: number; uri?: string; transferFee?: number; flags?: number }) =>
    post<{ nftokenId: string; txHash: string; account: string }>("/issuer-mint", params),

  issuerTransferOffer: (params: { nftokenId: string; destination?: string }) =>
    post<{ offerId: string; txHash: string }>("/issuer-transfer-offer", params),

  issuerBurn: (params: { nftokenId: string }) =>
    post<{ txHash: string; account: string }>("/issuer-burn", params),

  issuerCancelOffer: (params: { offerIds: string[] }) =>
    post<{ txHash: string }>("/issuer-cancel-offer", params),
};
