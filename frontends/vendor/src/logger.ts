type Level = "debug" | "info" | "warn" | "error";

const isDev = (import.meta as { env?: { DEV?: boolean } }).env?.DEV ?? false;

const COLORS: Record<Level, string> = {
  debug: "color:#888",
  info:  "color:#4af",
  warn:  "color:#fa4",
  error: "color:#f44;font-weight:bold",
};

function log(level: Level, scope: string, msg: string, data?: unknown): void {
  if (level === "debug" && !isDev) return;
  const prefix = `%c[${scope}]`;
  if (data !== undefined) {
    console[level](prefix, COLORS[level], msg, data);
  } else {
    console[level](prefix, COLORS[level], msg);
  }
}

function makeLogger(scope: string) {
  return {
    debug: (msg: string, data?: unknown) => log("debug", scope, msg, data),
    info:  (msg: string, data?: unknown) => log("info",  scope, msg, data),
    warn:  (msg: string, data?: unknown) => log("warn",  scope, msg, data),
    error: (msg: string, data?: unknown) => log("error", scope, msg, data),
  };
}

export const walletLog = makeLogger("wallet");
export const kycLog    = makeLogger("kyc");
export const nftLog    = makeLogger("nft");
