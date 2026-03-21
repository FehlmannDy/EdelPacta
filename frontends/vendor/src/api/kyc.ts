export type CredentialStatus = "accepted" | "pending_acceptance" | "none";

export const kycApi = {
  status: async (address: string, step?: "identity" | "tax"): Promise<CredentialStatus> => {
    const params = step ? `role=vendor&step=${step}` : "role=vendor";
    const res = await fetch(`/api/kyc/status/${address}?${params}`);
    const data = await res.json() as { status?: CredentialStatus; error?: string };
    if (!res.ok) throw new Error(data.error ?? "Failed to check KYC status");
    return data.status ?? "none";
  },

  start: async (step: "identity" | "tax"): Promise<{ verificationId: string; verificationUrl: string }> => {
    const res = await fetch("/api/kyc/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "vendor", step }),
    });
    const data = await res.json() as { verificationId?: string; verificationUrl?: string; error?: string };
    if (!res.ok) throw new Error(data.error ?? "Failed to start verification");
    return { verificationId: data.verificationId!, verificationUrl: data.verificationUrl! };
  },

  issue: async (address: string, step: "identity" | "tax"): Promise<void> => {
    const res = await fetch("/api/kyc/issue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, role: "vendor", step }),
    });
    const data = await res.json() as { error?: string };
    if (!res.ok) throw new Error(data.error ?? "Failed to issue credential");
  },

  deleteCredentials: async (address: string): Promise<void> => {
    const res = await fetch("/api/kyc/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, role: "vendor" }),
    });
    const data = await res.json() as { error?: string };
    if (!res.ok) throw new Error(data.error ?? "Failed to delete credentials");
  },

  prepareAccept: async (address: string, step: "identity" | "tax"): Promise<Array<Record<string, unknown>>> => {
    const res = await fetch(`/api/kyc/prepare-accept/${address}?role=vendor&step=${step}`);
    const data = await res.json() as { txs?: Array<Record<string, unknown>>; error?: string };
    if (!res.ok) throw new Error(data.error ?? "Failed to prepare accept txs");
    return data.txs ?? [];
  },
};
