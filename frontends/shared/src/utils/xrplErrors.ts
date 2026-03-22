const XRPL_CODE_MAP: Record<string, string> = {
  tecINSUFFICIENT_RESERVE: "Your account doesn't have enough XRP to cover the reserve requirement.",
  tecNO_DST: "The destination account doesn't exist on the ledger.",
  tecNO_DST_INSUF_XRP: "The destination account doesn't exist and the transfer amount is insufficient to create it.",
  tecNO_PERMISSION: "You don't have permission to perform this action.",
  tecOBJECT_NOT_FOUND: "The requested object was not found on the ledger.",
  tecNO_AUTH: "You are not authorized to hold this NFT.",
  tecOWNERS: "This account has too many objects (trust lines, offers, NFTs) to complete the action.",
  tecDUPLICATE: "This object already exists on the ledger.",
  tecINTERNAL: "An internal ledger error occurred. Try again.",
  tecUNFUNDED_OFFER: "Your account doesn't have enough XRP to fund this offer.",
  tecNO_ENTRY: "The specified entry does not exist.",
  tecEXPIRED: "This offer or object has expired.",
  temBAD_AMOUNT: "Invalid amount specified.",
  temBAD_FEE: "Invalid fee specified.",
  temDISABLED: "This feature is not enabled on this network.",
  temINVALID: "The transaction is malformed.",
  tefPAST_SEQ: "Transaction sequence number is in the past.",
  tefMAX_LEDGER: "The transaction has expired (max ledger exceeded). Try again.",
  terQUEUED: "Transaction queued — it will be submitted shortly.",
  terPRE_SEQ: "A prior transaction must complete first.",
};

export function translateXrplError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  for (const [code, translation] of Object.entries(XRPL_CODE_MAP)) {
    if (msg.includes(code)) return translation;
  }
  if (msg.includes("Account not found")) return "Account not found on this network. Make sure your wallet is funded on the WASM devnet.";
  if (msg.includes("Wallet is not connected")) return "Wallet disconnected. Please reconnect Otsu Wallet.";
  if (msg.includes("User rejected")) return "Transaction rejected in wallet.";
  return msg;
}
