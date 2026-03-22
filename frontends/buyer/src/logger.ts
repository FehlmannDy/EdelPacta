export { walletLog, kycLog } from "@shared/logger";

// Always log — needed for production Docker builds (isDev is false after vite build)
function fmt(level: string, scope: string, msg: string, data?: unknown) {
  const prefix = `[${scope}:${level}]`;
  data !== undefined ? console.log(prefix, msg, data) : console.log(prefix, msg);
}

export const escrowLog = {
  info:  (msg: string, data?: unknown) => fmt("info",  "escrow", msg, data),
  warn:  (msg: string, data?: unknown) => fmt("warn",  "escrow", msg, data),
  error: (msg: string, data?: unknown) => fmt("error", "escrow", msg, data),
  debug: (msg: string, data?: unknown) => fmt("debug", "escrow", msg, data),
};
