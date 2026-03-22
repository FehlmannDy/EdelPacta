import { useState, useEffect, useCallback } from "react";
import { kycApi, CredentialStatus } from "../api/kyc";
import { kycLog } from "@shared/logger";
import { readSSEStream } from "@shared/utils/readSSEStream";

export type KYCStep =
  | "checking"
  | "done"
  | "start"
  | "scanning"
  | "issuing"
  | "accepting"
  | "error";

export interface KYCState {
  step: KYCStep;
  verificationUrl: string | null;
  streamState: string | null;
  error: string | null;
  verificationStep: "identity" | "tax" | null;
}

export function useKYC(
  address: string | null,
  sign: (tx: Record<string, unknown>) => Promise<string>,
  submitTx: (txBlob: string) => Promise<unknown>
) {
  const [state, setState] = useState<KYCState>({
    step: "checking",
    verificationUrl: null,
    streamState: null,
    error: null,
    verificationStep: null,
  });

  const setStep = (step: KYCStep, extra: Partial<KYCState> = {}) =>
    setState((s) => ({ ...s, step, error: null, streamState: null, ...extra }));

  const acceptCredentialStep = useCallback(async (addr: string, step: "identity" | "tax") => {
    setState((s) => ({ ...s, step: "accepting", error: null, streamState: null, verificationStep: step }));
    kycLog.info("accepting credential", { addr, step });
    const txs = await kycApi.prepareAccept(addr, step);
    for (const tx of txs) {
      const txBlob = await sign(tx);
      await submitTx(txBlob);
    }
    kycLog.info("credential accepted", { count: txs.length, step });
  }, [sign, submitTx]);

  // Wait for verifier SSE, then issue + accept one credential step on XRPL.
  // Returns only when the credential is confirmed on-chain.
  const runVerificationStep = useCallback(async (
    verificationId: string,
    addr: string,
    step: "identity" | "tax",
  ) => {
    const label = step === "identity"
      ? "Step 1/2 — Scan your Swiss e-ID…"
      : "Step 2/2 — Scan your estate credential…";

    setState((s) => ({ ...s, streamState: label }));

    const response = await fetch(`/api/kyc/stream/${verificationId}`);
    if (!response.ok) throw new Error(`Stream request failed: ${response.statusText}`);

    for await (const event of readSSEStream(response)) {
      const eventState = event["state"] as string | undefined;
      kycLog.debug("SSE event", { state: eventState, step });

      if (eventState === "PENDING") {
        setState((s) => ({ ...s, streamState: label }));
      } else if (eventState === "SUCCESS") {
        kycLog.info("verification SUCCESS", { step });
        setState((s) => ({ ...s, step: "issuing", error: null, streamState: null, verificationStep: step }));
        await kycApi.issue(addr, step);
        await acceptCredentialStep(addr, step);
        return;
      } else if (eventState === "ERROR") {
        throw new Error((event["error"] as string) ?? "Verification failed");
      }
    }
  }, [acceptCredentialStep]);

  // On load: check both credentials and auto-accept any pending ones
  useEffect(() => {
    if (!address) {
      setState({ step: "checking", verificationUrl: null, streamState: null, error: null, verificationStep: null });
      return;
    }

    setStep("checking");
    kycLog.info("checking credential status", { address });

    const checkOnLoad = async () => {
      try {
        const [identityStatus, taxStatus] = await Promise.all([
          kycApi.status(address, "identity"),
          kycApi.status(address, "tax"),
        ]);
        kycLog.info("credential status", { address, identityStatus, taxStatus });

        if (identityStatus === "accepted" && taxStatus === "accepted") {
          setStep("done");
          return;
        }

        // Auto-accept credentials that were issued but not yet accepted on-chain
        if (identityStatus === "pending_acceptance") {
          await acceptCredentialStep(address, "identity");
        }
        if (taxStatus === "pending_acceptance") {
          await acceptCredentialStep(address, "tax");
        }

        if (
          (identityStatus === "accepted" || identityStatus === "pending_acceptance") &&
          (taxStatus === "accepted" || taxStatus === "pending_acceptance")
        ) {
          setStep("done");
          return;
        }

        setStep("start");
      } catch (err) {
        kycLog.warn("credential status check failed, defaulting to start", { err });
        setStep("start");
      }
    };

    void checkOnLoad();
  }, [address]);

  const startKYC = useCallback(async () => {
    if (!address) return;
    try {
      // --- Step 1: check if identity KYC already exists ---
      kycLog.info("checking identity credential", { address });
      const identityStatus = await kycApi.status(address, "identity");

      if (identityStatus === "pending_acceptance") {
        await acceptCredentialStep(address, "identity");
      } else if (identityStatus !== "accepted") {
        // Identity credential missing → run full verification flow
        setState((s) => ({ ...s, step: "scanning", error: null, streamState: null, verificationStep: "identity" }));
        kycLog.info("starting identity verification", { address });
        const { verificationId, verificationUrl } = await kycApi.start("identity");
        kycLog.info("identity session created", { verificationId });
        setState((s) => ({ ...s, verificationUrl }));
        await runVerificationStep(verificationId, address, "identity");
      } else {
        kycLog.info("identity credential already accepted, skipping", { address });
      }

      // --- Step 2: check if estate KYC already exists ---
      kycLog.info("checking estate credential", { address });
      const taxStatus = await kycApi.status(address, "tax");

      if (taxStatus === "pending_acceptance") {
        await acceptCredentialStep(address, "tax");
      } else if (taxStatus !== "accepted") {
        // Estate credential missing → run full verification flow
        setState((s) => ({ ...s, step: "scanning", error: null, streamState: null, verificationStep: "tax" }));
        kycLog.info("starting estate verification", { address });
        const { verificationId: taxId, verificationUrl: taxUrl } = await kycApi.start("tax");
        kycLog.info("estate session created", { verificationId: taxId });
        setState((s) => ({ ...s, verificationUrl: taxUrl }));
        await runVerificationStep(taxId, address, "tax");
      } else {
        kycLog.info("estate credential already accepted, skipping", { address });
      }

      setStep("done");
    } catch (err) {
      kycLog.error("KYC failed", { err });
      setState((s) => ({
        ...s,
        step: "error",
        error: err instanceof Error ? err.message : "KYC verification failed",
      }));
    }
  }, [address, runVerificationStep, acceptCredentialStep]);

  const retry = useCallback(() => setStep("start"), []);

  return { ...state, startKYC, retry };
}
