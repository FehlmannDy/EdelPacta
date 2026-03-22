import { Wallet, convertStringToHex, CredentialCreate, CredentialAccept, CredentialDelete } from "xrpl";
import { withClient } from "./xrplService";

const VERIFIER_BASE = process.env.VERIFIER_BASE_URL ?? "https://beta-verifier.edel-id.ch";

function getBetaidIssuerDid(): string {
  const did = process.env.BETAID_ISSUER_DID;
  if (!did) throw new Error("BETAID_ISSUER_DID environment variable is not set.");
  return did;
}

function getIssuerDid(): string {
  const did = process.env.ISSUER_DID;
  if (!did) throw new Error("ISSUER_DID environment variable is not set.");
  return did;
}

function field(path: string, filter?: unknown, optional = false) {
  return {
    path: [path],
    ...(filter !== undefined && { filter }),
    ...(optional && { optional: true }),
  };
}

const VC_SD_JWT_FORMAT = {
  "vc+sd-jwt": {
    "sd-jwt_alg_values": ["ES256"],
    "kb-jwt_alg_values": ["ES256"],
  },
};

// Vendor / Notary: Swiss electronic ID (betaid-sdjwt)
function buildEidPresentationDefinition() {
  return {
    accepted_issuer_dids: [getBetaidIssuerDid()],
    presentation_definition: {
      id: crypto.randomUUID(),
      input_descriptors: [
        {
          id: crypto.randomUUID(),
          format: VC_SD_JWT_FORMAT,
          constraints: {
            fields: [
              field("$.vct", { type: "string", const: "betaid-sdjwt" }),
              field("$.personal_administrative_number"),
            ],
          },
        },
      ],
    },
  };
}


const DEFAULT_NETWORK = process.env.XRPL_NETWORK ?? "wss://wasm.devnet.rippletest.net:51233";

export const CREDENTIAL_TYPE_HEX = convertStringToHex("SWIYU_KYC");
export const CREDENTIAL_TYPE_TAX_HEX = convertStringToHex("SWIYU_KYC_TAX");
const LSF_ACCEPTED = 0x00010000;

function getIssuerWallet(): Wallet {
  const seed = process.env.ISSUER_SEED;
  if (!seed) throw new Error("ISSUER_SEED environment variable is not set.");
  return Wallet.fromSeed(seed);
}

export function getIssuerAddress(): string {
  return getIssuerWallet().address;
}

// ---------------------------------------------------------------------------
// Verifier API
// ---------------------------------------------------------------------------

// Vendor: estate fiscal attestation credential
function buildEstatePresentationDefinition() {
  return {
    accepted_issuer_dids: [getIssuerDid()],
    presentation_definition: {
      id: crypto.randomUUID(),
      input_descriptors: [
        {
          id: crypto.randomUUID(),
          format: VC_SD_JWT_FORMAT,
          constraints: {
            fields: [
              field("$.vct", { type: "string", const: "estate" }),
              field("$.taxId", undefined, true),
              field("$.taxAddress", undefined, true),
              field("$.addressCountry", undefined, true),
              field("$.residencyStatus", undefined, true),
              field("$.fiscalYear", undefined, true),
              field("$.totalIncome", undefined, true),
              field("$.taxAmount", undefined, true),
              field("$.incomeThreshold", undefined, true),
              field("$.credentialStatus", undefined, true),
              field("$.currency", undefined, true),
            ],
          },
        },
      ],
    },
  };
}

export async function startVerification(role?: string, step?: string): Promise<{ verificationId: string; verificationUrl: string }> {
  const body = (role === "vendor" && step === "tax")
    ? buildEstatePresentationDefinition()
    : buildEidPresentationDefinition();

  const res = await fetch(`${VERIFIER_BASE}/management/api/verifications`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Verifier start failed (${res.status}): ${body || res.statusText}`);
  }
  const data = await res.json() as Record<string, unknown>;
  // The verifier returns id + verification_url (deeplink for QR code)
  const verificationId = data["id"] as string;
  const verificationUrl = (data["verification_url"] ?? data["verification_deeplink"]) as string;
  return { verificationId, verificationUrl };
}

export interface VerificationPollResult {
  state: "PENDING" | "SUCCESS" | "FAILED";
  verifiedClaims?: Array<Record<string, string>>;
  error?: string;
}

export async function pollVerificationStatus(verificationId: string): Promise<VerificationPollResult> {
  const res = await fetch(`${VERIFIER_BASE}/management/api/verifications/${verificationId}`);
  if (!res.ok) {
    throw new Error(`Verifier poll failed (${res.status}): ${res.statusText}`);
  }
  const data = await res.json() as Record<string, unknown>;
  const rawState = (data["state"] ?? data["status"]) as string | undefined;

  if (rawState === "SUCCESS") {
    // Claims are at wallet_response.credential_subject_data (matches Java impl)
    const walletResponse = data["wallet_response"] as Record<string, unknown> | undefined;
    const credSubject = walletResponse?.["credential_subject_data"] as Record<string, unknown> | undefined;
    const verifiedClaims = credSubject
      ? Object.entries(credSubject).map(([k, v]) => ({ [k]: String(v) }))
      : [];
    return { state: "SUCCESS", verifiedClaims };
  }
  if (rawState === "FAILED" || rawState === "ERROR") {
    return { state: "FAILED", error: (data["error"] as string) ?? "Verification failed" };
  }
  return { state: "PENDING" };
}

// ---------------------------------------------------------------------------
// Credential status
// ---------------------------------------------------------------------------

export type CredentialStatus = "accepted" | "pending_acceptance" | "none";

export async function checkCredentialStatus(
  subjectAddress: string,
  credentialTypes: string[] = [CREDENTIAL_TYPE_HEX],
  networkUrl = DEFAULT_NETWORK
): Promise<CredentialStatus> {
  const issuerAddress = getIssuerAddress();
  try {
    return await withClient(networkUrl, async (client) => {
      // Check which credential types are already accepted on subject's account
      const subjectRes = await client.request({
        command: "account_objects",
        account: subjectAddress,
        type: "credential",
      });
      const subjectObjects = subjectRes.result.account_objects as Record<string, unknown>[];

      const acceptedTypes = credentialTypes.filter((credType) =>
        subjectObjects.some(
          (obj) =>
            obj["LedgerEntryType"] === "Credential" &&
            obj["Issuer"] === issuerAddress &&
            obj["CredentialType"] === credType &&
            ((obj["Flags"] as number) & LSF_ACCEPTED) !== 0
        )
      );
      if (acceptedTypes.length === credentialTypes.length) return "accepted" as CredentialStatus;

      // Check issuer's account for credentials pending acceptance by subject
      const issuerRes = await client.request({
        command: "account_objects",
        account: issuerAddress,
        type: "credential",
      });
      const issuerObjects = issuerRes.result.account_objects as Record<string, unknown>[];

      const hasPending = credentialTypes.some(
        (credType) =>
          !acceptedTypes.includes(credType) &&
          issuerObjects.some(
            (obj) =>
              obj["LedgerEntryType"] === "Credential" &&
              obj["Subject"] === subjectAddress &&
              obj["CredentialType"] === credType &&
              ((obj["Flags"] as number) & LSF_ACCEPTED) === 0
          )
      );
      if (hasPending) return "pending_acceptance" as CredentialStatus;

      return "none" as CredentialStatus;
    });
  } catch {
    // Amendment not active or account not found — treat as none
    return "none";
  }
}

// ---------------------------------------------------------------------------
// Credential issuance (backend signs)
// ---------------------------------------------------------------------------

export async function issueCredential(
  subjectAddress: string,
  credentialTypes: string[] = [CREDENTIAL_TYPE_HEX],
  networkUrl = DEFAULT_NETWORK
): Promise<{ txHash: string }> {
  const issuer = getIssuerWallet();
  return withClient(networkUrl, async (client) => {
    let lastHash = "";
    for (const credType of credentialTypes) {
      const tx: CredentialCreate = {
        TransactionType: "CredentialCreate",
        Account: issuer.address,
        Subject: subjectAddress,
        CredentialType: credType,
      };

      const prepared = await client.autofill(tx);
      const signed = issuer.sign(prepared);
      const result = await client.submitAndWait(signed.tx_blob);
      const meta = result.result.meta as Record<string, unknown> | undefined;
      const txResult = meta?.["TransactionResult"] as string;

      // tecDUPLICATE means credential already issued — not an error for us
      if (txResult !== "tesSUCCESS" && txResult !== "tecDUPLICATE") {
        throw new Error(`CredentialCreate (${credType}) failed: ${txResult}`);
      }
      lastHash = signed.hash;
    }
    return { txHash: lastHash };
  });
}

// ---------------------------------------------------------------------------
// Prepare unsigned CredentialAccept for wallet signing
// ---------------------------------------------------------------------------

export async function deleteCredentials(
  subjectAddress: string,
  credentialTypes: string[] = [CREDENTIAL_TYPE_HEX],
  networkUrl = DEFAULT_NETWORK
): Promise<void> {
  const issuer = getIssuerWallet();
  return withClient(networkUrl, async (client) => {
    for (const credType of credentialTypes) {
      const tx: CredentialDelete = {
        TransactionType: "CredentialDelete",
        Account: issuer.address,
        Subject: subjectAddress,
        CredentialType: credType,
      };

      try {
        const prepared = await client.autofill(tx);
        const signed = issuer.sign(prepared);
        const result = await client.submitAndWait(signed.tx_blob);
        const meta = result.result.meta as Record<string, unknown> | undefined;
        const txResult = meta?.["TransactionResult"] as string;
        if (txResult !== "tesSUCCESS" && txResult !== "tecNO_ENTRY") {
          throw new Error(`CredentialDelete (${credType}) failed: ${txResult}`);
        }
      } catch (err) {
        // Credential may not exist — not an error
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes("tecNO_ENTRY") && !msg.includes("not found")) throw err;
      }
    }
  });
}

export async function prepareAcceptCredential(
  subjectAddress: string,
  credentialTypes: string[] = [CREDENTIAL_TYPE_HEX],
  networkUrl = DEFAULT_NETWORK
): Promise<Record<string, unknown>[]> {
  const issuer = getIssuerWallet();
  return withClient(networkUrl, async (client) => {
    // Only prepare TXes for credentials that are actually pending (on issuer, not yet accepted)
    const issuerRes = await client.request({
      command: "account_objects",
      account: issuer.address,
      type: "credential",
    });
    const issuerObjects = issuerRes.result.account_objects as Record<string, unknown>[];

    const pendingTypes = credentialTypes.filter((credType) =>
      issuerObjects.some(
        (obj) =>
          obj["LedgerEntryType"] === "Credential" &&
          obj["Subject"] === subjectAddress &&
          obj["CredentialType"] === credType &&
          ((obj["Flags"] as number) & LSF_ACCEPTED) === 0
      )
    );

    const txs: Record<string, unknown>[] = [];
    for (const credType of pendingTypes) {
      const tx: CredentialAccept = {
        TransactionType: "CredentialAccept",
        Account: subjectAddress,
        Issuer: issuer.address,
        CredentialType: credType,
      };
      txs.push(await client.autofill(tx) as unknown as Record<string, unknown>);
    }
    return txs;
  });
}
