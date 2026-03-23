import { useState } from "react";

/**
 * Encapsulates the reset-KYC flow: confirmation modal state, in-flight flag,
 * error message, and the async delete+callback logic.
 *
 * @param deleteKYC  Function that deletes credentials for the given address.
 * @param address    Current wallet address (may be undefined when disconnected).
 * @param onSuccess  Called after a successful deletion so callers can reset
 *                   their own local state (e.g. kycStep, flowStep, …).
 */
export function useKYCReset(
  deleteKYC: (address: string) => Promise<void>,
  address: string | null | undefined,
  onSuccess: () => void,
) {
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resettingKYC, setResettingKYC] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const handleResetKYC = async () => {
    if (!address || resettingKYC) return;
    setResettingKYC(true);
    setResetError(null);
    try {
      await deleteKYC(address);
      onSuccess();
    } catch (err) {
      setResetError(err instanceof Error ? err.message : "Failed to reset KYC");
    } finally {
      setResettingKYC(false);
    }
  };

  return { resetError, resettingKYC, handleResetKYC, resetModalOpen, setResetModalOpen };
}
