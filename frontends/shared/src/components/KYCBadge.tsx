/**
 * KYC status badge rendered in the app header.
 *
 * The step type is defined locally as a structural subset so shared does not
 * depend on any frontend-local useKYC hook. Any frontend's KYCStep value is
 * assignable to this type because TypeScript uses structural typing.
 *
 * Variants:
 *   "buyer"  — single badge, title "Identity verified on XRPL"
 *   "notary" — single badge, title "Swiss e-ID verified on XRPL"
 *   "vendor" — two badges: Swiss e-ID + Estate credential
 */

type KYCStepSubset = string | null;

interface KYCBadgeProps {
  step: KYCStepSubset;
  variant: "buyer" | "vendor" | "notary";
}

export function KYCBadge({ step, variant }: KYCBadgeProps) {
  if (!step || step === "checking") return null;

  if (step !== "done") {
    return (
      <span className="kyc-badge kyc-badge--pending" title="KYC in progress">
        ⏳ KYC…
      </span>
    );
  }

  if (variant === "vendor") {
    return (
      <>
        <span className="kyc-badge kyc-badge--done" title="Swiss e-ID verified on XRPL">
          🪪 ID Verified
        </span>
        <span className="kyc-badge kyc-badge--done kyc-badge--estate" title="Estate credential verified on XRPL">
          🏠 Estate Verified
        </span>
      </>
    );
  }

  const title =
    variant === "buyer" ? "Identity verified on XRPL" : "Swiss e-ID verified on XRPL";

  return (
    <span className="kyc-badge kyc-badge--done" title={title}>
      🪪 ID Verified
    </span>
  );
}
