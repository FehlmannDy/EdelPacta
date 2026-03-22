import { useState, useEffect, useCallback } from "react";
import { kycApi, CredentialStatus } from "../api/kyc";
import { kycLog } from "../logger";

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

async function* readSSEStream(
  response: Response
): AsyncGenerator<Record<string, unknown>> {
  if (!response.body) return;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split("\n");

    for (const line of lines) {
      if (line.startsWith("data:")) {
        const jsonData = line.substring(5).trim();
        if (jsonData) {
          try {
            yield JSON.parse(jsonData) as Record<string, unknown>;
          } catch {
            // malformed JSON — skip
          }
        }
      }
    }
  }
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
    setStep("accepting");
    try {
      kycLog.info("accepting credential", { addr });
      const txs = await kycApi.prepareAccept(addr);
      for (const tx of txs) {
        const txBlob = await sign(tx);
        await submitTx(txBlob);
      }
      kycLog.info("credential accepted", { count: txs.length });
      setStep("done");
    } catch (err) {
      kycLog.error("credential accept failed", { err });
      setState((s) => ({
        ...s,
        step: "error",
        error: err instanceof Error ? err.message : "Failed to accept credential",
      }));
    }
  }, [sign, submitTx]);

  // Check credential status on connect / address change
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
        else if (status === "pending_acceptance") acceptCredential(address);
        else setStep("start");
      })
      .catch((err) => {
        kycLog.warn("credential status check failed, defaulting to start", { err });
        setStep("start");
      });
  }, [address]);

  const listenForVerification = useCallback(async (verificationId: string, addr: string) => {
    try {
      const response = await fetch(kycApi.streamUrl(verificationId));

      if (!response.ok) {
        throw new Error(`Stream request failed: ${response.statusText}`);
      }

      for await (const event of readSSEStream(response)) {
        const eventState = event["state"] as string | undefined;

        kycLog.debug("SSE event", { state: eventState });

        setState((s) => ({
          ...s,
          streamState: eventState ? `Verification state: ${eventState}` : s.streamState,
        }));

        if (eventState === "SUCCESS") {
          kycLog.info("verification SUCCESS");
          setStep("issuing");
          await kycApi.issue(addr);
          await acceptCredential(addr);
          return;
        }

        if (eventState === "ERROR") {
          const errMsg = (event["error"] as string) ?? "Verification failed";
          kycLog.warn("verification ERROR from verifier", { error: errMsg });
          setState((s) => ({ ...s, step: "error", error: errMsg }));
          return;
        }
      }
    } catch (err) {
      kycLog.error("SSE stream error", { err });
      setState((s) => ({
        ...s,
        step: "error",
        error: err instanceof Error ? err.message : "Stream error",
      }));
    }
  }, [acceptCredential]);

  const startKYC = useCallback(async () => {
    if (!address) return;
    setStep("scanning");
    try {
      kycLog.info("starting KYC verification", { address });
      const { verificationId, verificationUrl } = await kycApi.start();
      kycLog.info("verification session created", { verificationId });
      setState((s) => ({ ...s, verificationUrl }));
      listenForVerification(verificationId, address);
    } catch (err) {
      kycLog.error("failed to start KYC", { err });
      setState((s) => ({
        ...s,
        step: "error",
        error: err instanceof Error ? err.message : "Failed to start KYC",
      }));
    }
  }, [address, listenForVerification]);

  const retry = useCallback(() => setStep("start"), []);

  return { ...state, startKYC, retry };
}
