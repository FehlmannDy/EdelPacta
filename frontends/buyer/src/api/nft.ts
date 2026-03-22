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

export interface SubmitResult {
  txHash: string;
  result: string;
}

export const nftApi = {
  prepareAcceptOffer: (params: { account: string; offerId: string }) =>
    post<Record<string, unknown>>("/prepare/accept-offer", params),

  submit: (txBlob: string) =>
    post<SubmitResult>("/submit", { txBlob }),
};
