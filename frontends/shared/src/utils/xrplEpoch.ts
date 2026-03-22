// XRPL epoch starts 2000-01-01, Unix epoch starts 1970-01-01 (diff = 946684800s)
const XRPL_EPOCH_OFFSET = 946684800;

export function formatXrplExpiry(expiration: number | null): string | null {
  if (!expiration) return null;
  const d = new Date((expiration + XRPL_EPOCH_OFFSET) * 1000);
  if (d < new Date()) return "Expired";
  return `Expires ${d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;
}

export function dropsToXrp(drops: string): string {
  const n = Number(drops);
  if (isNaN(n)) return drops;
  return n === 0 ? "Free" : `${(n / 1_000_000).toLocaleString()} XRP`;
}

export function xrplEpochToDate(rippleEpoch: number): Date {
  return new Date((rippleEpoch + XRPL_EPOCH_OFFSET) * 1000);
}
