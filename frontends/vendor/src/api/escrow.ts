import { makeApiClient } from "@shared/utils/apiClient";

const { post, get } = makeApiClient("/api/escrow");

export interface EscrowObject {
  Account: string;
  Destination: string;
  Amount: string; // XRP drops
  Sequence: number;
  CancelAfter?: number; // XRPL epoch seconds
  NftId?: string | null;
  BuyerAddress?: string | null;
  [key: string]: unknown;
}

export interface SuccessfulEscrow {
  escrowSequence: number;
  sellerAddress: string;
  buyerAddress: string | null;
  nftId: string | null;
  amountDrops: string;
  escrowCreateHash: string | null;
  escrowFinishHash: string | null;
  finishedLedgerIndex: number | null;
  finishedAt: string | null;
}

export const escrowApi = {
  bySeller: (address: string) =>
    get<{ escrows: EscrowObject[] }>(`/by-seller/${address}`),

  successfulBySeller: (address: string) =>
    get<{ escrows: SuccessfulEscrow[] }>(`/successful-by-seller/${address}`),

  prepareCancel: (params: {
    cancellerAddress: string;
    ownerAddress: string;
    offerSequence: number;
  }) => post<Record<string, unknown>>("/prepare-cancel", params),
};
