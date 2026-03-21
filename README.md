# EdelPacta

Property title deed platform on the XRP Ledger. Notaries mint and transfer NFT title deeds; vendors complete KYC (Swiss e-ID + estate attestation) and accept transfers on-chain.

## Architecture

```
EdelPacta/
├── backend/          # Express + Bun API server (XRPL, IPFS, KYC verifier)
├── frontends/
│   ├── notary/       # Notary UI (Vite + React) — port 3000
│   └── vendor/       # Vendor UI (Vite + React) — port 3001
└── docker-compose.yml
```

---

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- Or, for local dev: [Bun](https://bun.sh/) ≥ 1.0 and Node.js ≥ 18

---

## Environment setup

If you don't have an issuer wallet yet, run the init script — it generates a fresh XRPL wallet and funds it automatically via the devnet faucet:

```bash
bun scripts/init-wallet.ts
```

This writes `ISSUER_SEED` and `ISSUER_ADDRESS` into `.env` (creating the file if needed). You then only have to fill in the DID values manually (see table below).

If you already have a wallet, copy `.env.example` instead:

```bash
cp .env.example .env
```

| Variable | Required | Description |
|---|---|---|
| `ISSUER_SEED` | yes | XRPL wallet seed (`sEd…`) used by the backend to sign credentials |
| `ISSUER_ADDRESS` | yes | XRPL address matching the issuer seed (`r…`) |
| `ISSUER_DID` | yes | DID of the EdelPacta estate-credential issuer (swiyu trust infrastructure) |
| `BETAID_ISSUER_DID` | yes | DID of the betaid issuer for Swiss e-ID verification (swiyu trust infrastructure) |
| `XRPL_NETWORK` | no | XRPL WebSocket node URL (default: `wss://wasm.devnet.rippletest.net:51233`) |
| `VERIFIER_BASE_URL` | no | swiyu OID4VP verifier base URL (default: `https://beta-verifier.edel-id.ch`) |
| `VITE_IPFS_GATEWAY` | no | Public IPFS gateway URL used by the frontends (default: `http://localhost:8080/ipfs`) |

> **Important:** never commit `.env` — it contains the wallet seed. `.gitignore` already excludes it.

---

## Running with Docker (recommended)

```bash
# Build and start all services (logs printed to terminal, stop with CTRL+C)
docker compose up --build

# Or run in the background
docker compose up --build -d

# Stop background services
docker compose down
```

| Service | URL |
|---|---|
| Notary UI | http://localhost:3000 |
| Vendor UI | http://localhost:3001 |
| Backend API | internal (not exposed directly) |
| IPFS (Kubo) gateway | http://localhost:8080 |

---

## Running locally (dev mode)

### Backend

```bash
cd backend
bun install
bun run dev        # starts with --watch on port 8080
```

### Notary frontend

```bash
cd frontends/notary
npm install
npm run dev        # http://localhost:3000
```

### Vendor frontend

```bash
cd frontends/vendor
npm install
npm run dev        # http://localhost:3001
```

### IPFS node (required for NFT metadata)

```bash
docker run -p 4001:4001 -p 5001:5001 -p 8080:8080 ipfs/kubo:latest
```

---

## Wallet requirement

Both the notary and vendor UIs require the **Otsu wallet** browser extension to connect and sign XRPL transactions.

- [Install for Chrome](https://chromewebstore.google.com/detail/otsu/aifpdkijgdmhbgdomhgfklhifcjaolne)
- [Install for Firefox](https://addons.mozilla.org/firefox/addon/otsu-wallet/)

Once installed, create or import an XRPL account and fund it on devnet before using the app.

---

## KYC flow (notary)

Notaries must complete a single identity verification step before they can mint or transfer title deeds.

1. **Connect** the Otsu wallet — the app checks on-chain whether a `SWIYU_KYC` credential already exists for the address.
2. **Scan the QR code** displayed in the app using the Otsu wallet's built-in scanner. This triggers an OID4VP presentation request to the swiyu verifier for the notary's Swiss e-ID (`betaid-sdjwt` credential, including `personal_administrative_number`).
3. **Wait for verification** — the backend polls the swiyu verifier every 2 seconds via SSE until it returns `SUCCESS`.
4. **Credential issued** — the backend signs and submits a `CredentialCreate` transaction on XRPL, issuing the `SWIYU_KYC` credential to the notary's address.
5. **Credential accepted** — the Otsu wallet automatically signs and submits a `CredentialAccept` transaction; the notary UI unlocks.

If the credential is already present on-chain (e.g. after a page reload), steps 2–5 are skipped automatically.

---

## KYC flow (vendor)

Vendors must complete two sequential verification steps before they can accept a property transfer.

### Step 1 — Swiss e-ID (`SWIYU_KYC`)

1. **Connect** the Otsu wallet — the app checks whether a `SWIYU_KYC` credential exists for the address.
2. **Scan the QR code** using the Otsu wallet. This triggers an OID4VP request for the vendor's Swiss e-ID (`betaid-sdjwt`, including `personal_administrative_number`).
3. **Wait for verification** — backend polls the swiyu verifier via SSE until `SUCCESS`.
4. **Credential issued** — backend submits a `CredentialCreate` for `SWIYU_KYC` on XRPL.
5. **Credential accepted** — Otsu wallet signs the `CredentialAccept` transaction.

### Step 2 — Estate attestation (`SWIYU_KYC_TAX`)

6. **Scan a second QR code** — this time the OID4VP request targets the vendor's estate fiscal credential (`estate` VC, including tax ID, income, residency status, etc.) issued by the EdelPacta issuer DID.
7. **Wait for verification** — same SSE polling flow.
8. **Credential issued** — backend submits a `CredentialCreate` for `SWIYU_KYC_TAX` on XRPL.
9. **Credential accepted** — Otsu wallet signs the `CredentialAccept`; the vendor UI unlocks.

Both credentials must be accepted on-chain before the transfer UI becomes available. Each step is skipped automatically if the credential already exists on-chain.
