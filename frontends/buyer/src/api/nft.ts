import { makeApiClient } from "@shared/utils/apiClient";

const { post, get } = makeApiClient(`${import.meta.env.VITE_API_BASE_URL ?? ""}/api/nft`);

export interface SubmitResult {
  txHash: string;
  result: string;
}

export interface NftItem {
  nftokenId: string;
  uri: string | null;
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

export interface IncomingOffer {
  offerId: string;
  nftokenId: string;
  owner: string;
  amount: string;
  expiration: number | null;
}

export const nftApi = {
  prepareAcceptOffer: (params: { account: string; offerId: string }) =>
    post<Record<string, unknown>>("/prepare/accept-offer", params),

  prepareCancelOffer: (params: { account: string; offerIds: string[] }) =>
    post<Record<string, unknown>>("/prepare/cancel-offer", params),

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

  list: (address: string) =>
    get<{ nfts: NftItem[] }>(`/list/${address}`).then((r) => r.nfts),
};
