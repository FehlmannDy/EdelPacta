import { makeApiClient } from "@shared/utils/apiClient";

const { post, get } = makeApiClient("/api/nft");

export interface PreparedTx {
  [key: string]: unknown;
}

export interface SubmitResult {
  txHash: string;
  result: string;
  nftokenId?: string;
  offerId?: string;
}

export interface NFToken {
  nftokenId: string;
  issuer: string;
  taxon: number;
  transferFee: number;
  flags: number;
  uri: string | null;
}

export interface NFTListResult {
  account: string;
  nfts: NFToken[];
  count: number;
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

export interface IncomingOffer {
  offerId: string;
  nftokenId: string;
  owner: string;
  amount: string;
  expiration: number | null;
}

export interface OfferDetails {
  offerId: string;
  sequence: number;
  nftokenId: string;
  destination: string | null;
}

export const nftApi = {
  prepareMint: (params: {
    account: string;
    taxon: number;
    uri?: string;
    transferFee?: number;
    flags?: number;
  }) => post<PreparedTx>("/prepare/mint", params),

  prepareTransferOffer: (params: {
    account: string;
    nftokenId: string;
    destination?: string;
    amount?: string;
  }) => post<PreparedTx>("/prepare/transfer-offer", params),

  prepareAcceptOffer: (params: {
    account: string;
    offerId: string;
  }) => post<PreparedTx>("/prepare/accept-offer", params),

  prepareBurn: (params: { account: string; nftokenId: string }) =>
    post<PreparedTx>("/prepare/burn", params),

  submit: (txBlob: string) =>
    post<SubmitResult>("/submit", { txBlob }),

  list: (address: string) =>
    fetch(`/api/nft/list/${address}`)
      .then((r) => r.json() as Promise<NFTListResult>),

  incomingOffers: (address: string, nftokenId: string) =>
    fetch(`/api/nft/offers/incoming/${address}/${nftokenId}`)
      .then(async (r) => {
        const data = await r.json() as { offers?: NFTOffer[]; error?: string };
        if (!r.ok) throw new Error(data.error ?? "Failed to fetch offers");
        return data.offers ?? [];
      }),

  incomingOffersForAccount: (address: string) =>
    fetch(`/api/nft/offers/incoming-for-account/${address}`)
      .then(async (r) => {
        const data = await r.json() as { offers?: IncomingOffer[]; error?: string };
        if (!r.ok) throw new Error(data.error ?? "Failed to fetch incoming offers");
        return data.offers ?? [];
      }),

  getOffer: (offerId: string) =>
    fetch(`/api/nft/offer/${offerId}`)
      .then(async (r) => {
        const data = await r.json() as OfferDetails & { error?: string };
        if (!r.ok) throw new Error(data.error ?? "Failed to fetch offer details");
        return data as OfferDetails;
      }),

  outgoingOffers: (address: string) =>
    get<{ offers: NFTOffer[] }>(`/offers/outgoing/${address}`).then((r) => r.offers),
};
