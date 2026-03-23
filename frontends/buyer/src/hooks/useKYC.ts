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
  });

  const setStep = (step: KYCStep, extra: Partial<KYCState> = {}) =>
    setState((s) => ({ ...s, step, error: null, streamState: null, ...extra }));

  const acceptCredential = useCallback(async (addr: string) => {
    setState((s) => ({ ...s, step: "accepting", error: null, streamState: null }));
    try {
      kycLog.info("accepting credential", { addr });
      const txs = await kycApi.prepareAccept(addr);
      for (const tx of txs) {
        const txBlob = await sign(tx);
        await submitTx(txBlob);
      }
      kycLog.info("credential accepted", { count: txs.length });
    } catch (err) {
      kycLog.error("credential accept failed", { err });
      setState((s) => ({
        ...s,
        step: "error",
        error: err instanceof Error ? err.message : "Failed to accept credential",
      }));
      throw err;
    }
  }, [sign, submitTx]);

  useEffect(() => {
    if (!address) {
      setState({ step: "checking", verificationUrl: null, streamState: null, error: null });
      return;
    }

    setStep("checking");
    kycLog.info("checking credential status", { address });

    kycApi.status(address)
      .then((status: CredentialStatus) => {
        kycLog.info("credential status", { address, status });
        if (status === "accepted") setStep("done");
        else if (status === "pending_acceptance") acceptCredential(address).then(() => setStep("done")).catch(() => {});
        else setStep("start");
      })
      .catch((err) => {
        kycLog.warn("credential status check failed, defaulting to start", { err });
        setStep("start");
      });
  }, [address]);

  const startKYC = useCallback(async () => {
    if (!address) return;
    try {
      const status = await kycApi.status(address);
      if (status === "pending_acceptance") {
        await acceptCredential(address);
        setStep("done");
        return;
      }
      if (status === "accepted") {
        setStep("done");
        return;
      }

      setState((s) => ({ ...s, step: "scanning", error: null, streamState: null, verificationUrl: null }));
      kycLog.info("starting KYC verification", { address });
      const { verificationId, verificationUrl } = await kycApi.start();
      kycLog.info("verification session created", { verificationId });
      if (!verificationUrl) throw new Error("Verifier did not return a verification URL");
      setState((s) => ({ ...s, verificationUrl }));
      // Yield to the event loop so React renders the QR code before SSE events arrive
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      const response = await fetch(kycApi.streamUrl(verificationId));
      if (!response.ok) throw new Error(`Stream request failed: ${response.statusText}`);

      for await (const event of readSSEStream(response)) {
        const eventState = event["state"] as string | undefined;
        kycLog.debug("SSE event", { state: eventState });

        if (eventState === "SUCCESS") {
          kycLog.info("verification SUCCESS");
          setState((s) => ({ ...s, step: "issuing", error: null, streamState: null }));
          await kycApi.issue(address);
          await acceptCredential(address);
          setStep("done");
          return;
        }
        if (eventState === "ERROR" || eventState === "DECLINED") {
          throw new Error(
            eventState === "DECLINED"
              ? "Verification was declined. Please try again."
              : ((event["error"] as string) ?? "Verification failed")
          );
        }
        if (eventState === "EXPIRED") {
          throw new Error("Verification session expired. Please try again.");
        }
        // For other states (e.g. PENDING), surface them in the UI
        if (eventState) {
          setState((s) => ({ ...s, streamState: eventState }));
        }
      }
      // Stream closed without a terminal event (server timeout / network drop)
      throw new Error("Verification session ended unexpectedly. Please try again.");
    } catch (err) {
      kycLog.error("KYC failed", { err });
      setState((s) => ({
        ...s,
        step: "error",
        error: err instanceof Error ? err.message : "KYC verification failed",
      }));
    }
  }, [address, acceptCredential]);

  const retry = useCallback(() => setStep("start"), []);

  return { ...state, startKYC, retry };
}
