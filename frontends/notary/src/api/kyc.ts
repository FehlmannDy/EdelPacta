export type CredentialStatus = "accepted" | "pending_acceptance" | "none";

export const kycApi = {
  status: async (address: string): Promise<CredentialStatus> => {
    const res = await fetch(`/api/kyc/status/${address}`);
    const data = await res.json() as { status?: CredentialStatus; error?: string };
    if (!res.ok) throw new Error(data.error ?? "Failed to check KYC status");
    return data.status ?? "none";
  },

  start: async (): Promise<{ verificationId: string; verificationUrl: string }> => {
    const res = await fetch("/api/kyc/start", { method: "POST" });
    const data = await res.json() as { verificationId?: string; verificationUrl?: string; error?: string };
    if (!res.ok) throw new Error(data.error ?? "Failed to start verification");
    return { verificationId: data.verificationId!, verificationUrl: data.verificationUrl! };
  },

  issue: async (address: string): Promise<void> => {
    const res = await fetch("/api/kyc/issue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
    });
    const data = await res.json() as { error?: string };
    if (!res.ok) throw new Error(data.error ?? "Failed to issue credential");
  },

  deleteCredentials: async (address: string): Promise<void> => {
    const res = await fetch("/api/kyc/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
    });
    const data = await res.json() as { error?: string };
    if (!res.ok) throw new Error(data.error ?? "Failed to delete credentials");
  },

  prepareAccept: async (address: string): Promise<Array<Record<string, unknown>>> => {
    const res = await fetch(`/api/kyc/prepare-accept/${address}`);
    const data = await res.json() as { txs?: Array<Record<string, unknown>>; error?: string };
    if (!res.ok) throw new Error(data.error ?? "Failed to prepare accept txs");
    return data.txs ?? [];
  },

  checkVendorKYC: async (address: string): Promise<{ identity: CredentialStatus; tax: CredentialStatus }> => {
    const [idRes, taxRes] = await Promise.all([
      fetch(`/api/kyc/status/${address}?role=vendor&step=identity`),
      fetch(`/api/kyc/status/${address}?role=vendor&step=tax`),
    ]);
    const [idData, taxData] = await Promise.all([
      idRes.json() as Promise<{ status?: CredentialStatus; error?: string }>,
      taxRes.json() as Promise<{ status?: CredentialStatus; error?: string }>,
    ]);
    if (!idRes.ok) throw new Error(idData.error ?? "Failed to check identity KYC");
    if (!taxRes.ok) throw new Error(taxData.error ?? "Failed to check estate KYC");
    return {
      identity: idData.status ?? "none",
      tax: taxData.status ?? "none",
    };
  },
};
