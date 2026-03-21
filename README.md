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

Copy `.env.example` to `.env` at the repo root and fill in each value:

```bash
cp .env.example .env
```

| Variable | Description |
|---|---|
| `ISSUER_SEED` | XRPL wallet seed (`sEd…`) used by the backend to sign credentials |
| `ISSUER_ADDRESS` | XRPL address matching the issuer seed (`r…`) |
| `ISSUER_DID` | DID of the EdelPacta estate-credential issuer (swiyu trust infrastructure) |
| `BETAID_ISSUER_DID` | DID of the betaid issuer for Swiss e-ID verification (swiyu trust infrastructure) |
| `VITE_IPFS_GATEWAY` | Public IPFS gateway URL used by the frontends (e.g. `http://localhost:8080/ipfs`) |

> **Important:** never commit `.env` — it contains the wallet seed. `.gitignore` already excludes it.

---

## Running with Docker (recommended)

```bash
# Build and start all services
docker compose up --build

# Stop
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

## KYC flow (vendor)

Vendors must complete two verification steps before they can accept a property transfer:

1. **Swiss e-ID** — scans a QR code in the [Otsu wallet](https://otsu.finance/) to present their betaid credential; the backend issues a `SWIYU_KYC` credential on XRPL.
2. **Estate attestation** — scans a second QR code to present their estate fiscal credential; the backend issues a `SWIYU_KYC_TAX` credential on XRPL.

Both credentials must be accepted on-chain by the vendor's wallet before the transfer UI unlocks.
