const isDev = import.meta.env.DEV;

function fmt(level: string, msg: string, data?: unknown) {
  if (!isDev) return;
  const prefix = `[buyer:${level}]`;
  data !== undefined ? console.log(prefix, msg, data) : console.log(prefix, msg);
}

export const escrowLog = {
  info:  (msg: string, data?: unknown) => fmt("info",  msg, data),
  warn:  (msg: string, data?: unknown) => fmt("warn",  msg, data),
  error: (msg: string, data?: unknown) => fmt("error", msg, data),
  debug: (msg: string, data?: unknown) => fmt("debug", msg, data),
};

export const kycLog = {
  info:  (msg: string, data?: unknown) => fmt("info",  msg, data),
  warn:  (msg: string, data?: unknown) => fmt("warn",  msg, data),
  error: (msg: string, data?: unknown) => fmt("error", msg, data),
  debug: (msg: string, data?: unknown) => fmt("debug", msg, data),
};

export const walletLog = {
  info:  (msg: string, data?: unknown) => fmt("info",  msg, data),
  warn:  (msg: string, data?: unknown) => fmt("warn",  msg, data),
  error: (msg: string, data?: unknown) => fmt("error", msg, data),
  debug: (msg: string, data?: unknown) => fmt("debug", msg, data),
};
