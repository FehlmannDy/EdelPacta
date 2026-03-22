# EdelPacta

> **Pacta sunt servanda. By code.**

Buying real estate in Switzerland requires locking millions of CHF in a notary's bank account for up to 8 weeks, paying 1–2% in fees, and relying on paper-based identity checks. There is no cryptographic proof that the seller legally owns the asset or has passed compliance.

EdelPacta replaces the notary's bank account with an **XRPL Smart Escrow powered by WASM Hooks**. Property titles are minted as NFTs, identity is verified via the Swiss Government's digital ID (Swiyu), and settlement is atomic — funds and title swap in a single transaction enforced at protocol level.

| | Traditional | EdelPacta |
|---|---|---|
| Settlement | 8 weeks | 3 seconds |
| Fees | ~CHF 20,000 | < CHF 0.01 |
| KYC | Paper documents | Swiyu e-ID / SD-JWT |
| Counterparty risk | Central point of failure | Zero — WASM enforced |

---

## How it works

```
Seller (Vendor)                 Notary                    Buyer
      |                            |                         |
      | 1. KYC via Swiyu e-ID      |                         |
      |   SWIYU_KYC on-chain ──────┤                         |
      |   SWIYU_KYC_TAX on-chain   |                         |
      |                            | 2. Mint property NFT    |
      |                            |   XLS-20 on XRPL ───────┤
      |                            |                         | 3. KYC via Swiyu e-ID
      |                            |                         |   SWIYU_KYC on-chain
      | 4. Create NFT sell offer   |                         |
      |   Destination = Buyer ─────┼─────────────────────────┤
      |                            |                         | 5. Lock XRP in escrow
      |                            |                         |   WASM FinishFunction
      |                            |                         | 6. Accept NFT sell offer
      |                            |                         |   NFT title transferred
      |                            | 7. Sign EscrowFinish    |
      |                            |   WASM verifies 5 conds |
      |                            |   → Returns 1           |
      | ← XRP released             |                         | (NFT already held)
```

**The 5 conditions enforced inside the WASM Hook (Rust):**

1. EscrowFinish submitted by the notary address
2. Seller holds an accepted `SWIYU_KYC` credential on-chain
3. Buyer already holds the property NFT at finalization time (ownership verified on-chain)
4. Notary ECDSA signature on the NFT ID is valid
5. Oracle ECDSA signature on the NFT ID is valid (independent co-signer)

If any condition fails, the Hook returns `0` and the escrow stays locked. The buyer can cancel after a 2-hour timeout.

---

## Architecture

```
EdelPacta/
├── backend/              # Express + Bun API (XRPL, IPFS, KYC verifier, escrow)
├── contract/             # WASM Hook in Rust (xrpl-wasm-stdlib)
│   └── src/lib.rs        # finish() — 6-condition escrow validation
├── frontends/
│   ├── notary/           # Notary UI — port 3000
│   ├── vendor/           # Vendor/Seller UI — port 3001
│   ├── buyer/            # Buyer UI — port 3002
│   └── shared/           # Shared components and context
└── docker-compose.yml
```

**Stack:** XRP Ledger · WASM Hooks (Rust) · XLS-20 NFTs · XLS-34 Credentials · Swiyu e-ID (OID4VP / SD-JWT) · IPFS (Kubo) · React + xrpl.js · Bun/Express

---

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- Or for local dev: [Bun](https://bun.sh/) ≥ 1.0 and Node.js ≥ 18
- [Otsu wallet](https://chromewebstore.google.com/detail/otsu/aifpdkijgdmhbgdomhgfklhifcjaolne) browser extension (Chrome / [Firefox](https://addons.mozilla.org/firefox/addon/otsu-wallet/))

---

## Environment setup

Generate a fresh funded devnet wallet:

```bash
bun scripts/init-wallet.ts
```

Or copy the example and fill in manually:

```bash
cp .env.example .env
```

| Variable | Required | Description |
|---|---|---|
| `ISSUER_SEED` | yes | XRPL wallet seed (`sEd…`) used by the backend |
| `ISSUER_ADDRESS` | yes | XRPL address matching the issuer seed (`r…`) |
| `ORACLE_SEED` | yes | Oracle wallet seed for dual-signing (can equal `ISSUER_SEED` on devnet) |
| `ISSUER_DID` | yes | DID of the EdelPacta estate-credential issuer |
| `BETAID_ISSUER_DID` | yes | DID of the Swiyu betaid issuer for Swiss e-ID |
| `XRPL_NETWORK` | no | XRPL WebSocket URL (default: `wss://wasm.devnet.rippletest.net:51233`) |
| `VERIFIER_BASE_URL` | no | Swiyu OID4VP verifier URL (default: `https://beta-verifier.edel-id.ch`) |
| `VITE_IPFS_GATEWAY` | no | IPFS gateway for frontends (default: `http://localhost:8080/ipfs`) |

> Never commit `.env` — it contains wallet seeds. `.gitignore` already excludes it.

---

## Running with Docker (recommended)

```bash
docker compose up --build
```

| Service | URL |
|---|---|
| Notary UI | http://localhost:3000 |
| Vendor UI | http://localhost:3001 |
| Buyer UI | http://localhost:3002 |
| IPFS gateway | http://localhost:8080 |

---

## Running locally (dev mode)

```bash
# Backend
cd backend && bun install && bun run dev       # port 8080

# Notary
cd frontends/notary && npm install && npm run dev   # port 3000

# Vendor
cd frontends/vendor && npm install && npm run dev   # port 3001

# Buyer
cd frontends/buyer && npm install && npm run dev    # port 3002

# IPFS
docker run -p 4001:4001 -p 5001:5001 -p 8080:8080 ipfs/kubo:latest
```

---

## User flows

### Notary

1. Connect Otsu wallet
2. Complete Swiss e-ID KYC via Swiyu — backend issues `SWIYU_KYC` credential on-chain
3. Upload property metadata to IPFS
4. Mint property title as an XLS-20 NFT — returns the `NFTokenID`
5. Provide the NFT ID to the vendor (off-band)
6. When the buyer has accepted the NFT sell offer and holds the title, sign the `EscrowFinish` transaction — the WASM Hook verifies all 5 conditions (including buyer NFT ownership) and releases funds atomically

### Vendor (Seller)

1. Connect Otsu wallet
2. Complete two KYC steps:
   - **Swiss e-ID** — Swiyu app scan → `SWIYU_KYC` credential on-chain
   - **Estate attestation** — fiscal/tax scan → `SWIYU_KYC_TAX` credential on-chain
3. Accept the incoming NFT transfer from the notary
4. Create a sell offer for the buyer — enter the buyer's address, sign `NFTokenCreateOffer`
5. Share the **Offer ID** and **Offer Sequence** with the buyer
6. Receive XRP automatically when the escrow is finalized

### Buyer

1. Connect Otsu wallet
2. Complete Swiss e-ID KYC via Swiyu — backend issues `SWIYU_KYC` credential on-chain
3. Create the smart escrow:
   - Enter the vendor address, NFT ID, and XRP amount
   - Sign the `Payment` transaction (funds transferred to escrow account)
   - Backend creates `EscrowCreate` with the WASM binary embedded as `FinishFunction`
4. Enter the vendor's Offer ID and accept the NFT sell offer — sign `NFTokenAcceptOffer` to receive the property title NFT
5. Finalize settlement — backend submits `EscrowFinish` with the buyer address memo; WASM verifies buyer holds the NFT and all 5 conditions, then releases funds to the seller
6. View owned property titles in the portfolio tab

> If the session is interrupted, the buyer can resume any pending escrow by reconnecting the wallet — active escrows are retrieved from on-chain transaction history via buyer address matching.

---

## KYC in detail

All identity verification uses **OID4VP** presentation requests to the Swiyu verifier. The backend polls for the result via SSE every 2 seconds (5-minute timeout). On success, it issues an XRPL credential (`CredentialCreate`); the Otsu wallet auto-signs the `CredentialAccept`. Credentials are checked on-chain by the WASM Hook at escrow finalization — no off-chain trust required.

| Role | Credentials required |
|---|---|
| Notary | `SWIYU_KYC` (Swiss e-ID) |
| Vendor | `SWIYU_KYC` (Swiss e-ID) + `SWIYU_KYC_TAX` (estate attestation) |
| Buyer | `SWIYU_KYC` (Swiss e-ID) |

---

## WASM Hook

The smart contract lives in `contract/src/lib.rs`, compiled to `my_contract_devnet.wasm`. It is embedded directly in the `EscrowCreate` transaction as the `FinishFunction` field — a custom field added via a patched `ripple-binary-codec`.

The `finish()` entry point reads condition data from 6 memos passed in the `EscrowFinish` transaction:

| Memo | Content |
|---|---|
| 0 | `NFT_ID` — 32-byte property NFT identifier |
| 1 | `NOTARY_SIG` — DER-encoded secp256k1 signature |
| 2 | `NOTARY_PUBKEY` — 33-byte compressed public key |
| 3 | `ORACLE_SIG` — DER-encoded secp256k1 signature |
| 4 | `ORACLE_PUBKEY` — 33-byte compressed public key |
| 5 | `BUYER_ADDR` — 20-byte buyer AccountID |

Returns `1` to release funds, `0` to keep the escrow locked.
