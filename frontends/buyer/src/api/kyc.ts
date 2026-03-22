const BASE = `${import.meta.env.VITE_API_BASE_URL ?? ""}/api/kyc`;

export type CredentialStatus = "accepted" | "pending_acceptance" | "none";

export const kycApi = {
  status: async (address: string): Promise<CredentialStatus> => {
    const res = await fetch(`${BASE}/status/${address}`);
    const data = await res.json() as { status?: CredentialStatus; error?: string };
    if (!res.ok) throw new Error(data.error ?? "Failed to check KYC status");
    return data.status ?? "none";
  },

  start: async (): Promise<{ verificationId: string; verificationUrl: string }> => {
    const res = await fetch(`${BASE}/start`, { method: "POST" });
    const data = await res.json() as { verificationId?: string; verificationUrl?: string; error?: string };
    if (!res.ok) throw new Error(data.error ?? "Failed to start verification");
    return { verificationId: data.verificationId!, verificationUrl: data.verificationUrl! };
  },

  issue: async (address: string): Promise<void> => {
    const res = await fetch(`${BASE}/issue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
    });
    const data = await res.json() as { error?: string };
    if (!res.ok) throw new Error(data.error ?? "Failed to issue credential");
  },

  prepareAccept: async (address: string): Promise<Array<Record<string, unknown>>> => {
    const res = await fetch(`${BASE}/prepare-accept/${address}`);
    const data = await res.json() as { txs?: Array<Record<string, unknown>>; error?: string };
    if (!res.ok) throw new Error(data.error ?? "Failed to prepare accept txs");
    return data.txs ?? [];
  },

  streamUrl: (verificationId: string): string => `${BASE}/stream/${verificationId}`,
};
