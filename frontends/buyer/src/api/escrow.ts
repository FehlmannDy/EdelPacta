import { makeApiClient } from "@shared/utils/apiClient";

const { post, get } = makeApiClient(`${import.meta.env.VITE_API_BASE_URL ?? ""}/api/escrow`);

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
  Amount: string; // XRP drops
  Sequence: number;
  CancelAfter?: number; // Ripple epoch seconds
  NftId?: string; // NFT token ID extracted from the EscrowCreate transaction memo
  Memos?: Array<{ Memo: { MemoType?: string; MemoData?: string } }>;
  [key: string]: unknown;
}

export const escrowApi = {
  preparePayment: (params: { buyerAddress: string; amountXrp: number }) =>
    post<{ tx: Record<string, unknown>; reserveOverheadXrp: number }>("/prepare-payment", params),

  create: (params: {
    paymentTxBlob: string;
    buyerAddress: string;
    sellerAddress: string;
    nftId: string;
    amountXrp: number;
  }) => post<CreateEscrowResult>("/create", params),

  finish: (params: { escrowSequence: number; nftId: string; offerSequence: number }) =>
    post<FinishEscrowResult>("/finish", params),

  byBuyer: (address: string) =>
    get<{ escrows: EscrowObject[] }>(`/by-buyer/${address}`),

};
