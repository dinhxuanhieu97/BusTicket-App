# PNTicket — Online bus ticketing platform for coach operators

🇻🇳 [Tiếng Việt](README.md) · 🇬🇧 English

A platform where passengers book sleeper/limousine coach tickets online (pick a seat, pay by QR bank transfer, receive a ticket), and where operators manage trips, seat inventory, deposits and automatic reconciliation — especially during holiday and Tết peaks. It is **multi-operator**; Phong Nhung (`PN`) is the first operator.

> Product documents (`docs/`), `task.md` and `CLAUDE.md` are written in Vietnamese. Code, identifiers and commit messages are in English.

## Status

| Part | Status |
|---|---|
| `apps/api` — seat inventory, auth/roles, anti-hoarding, SePay payments (T1–T6) | ✅ Done, 338 tests |
| `apps/miniapp` — Zalo Mini App for passengers (T11) | 🚧 Skeleton: search trips → pick seats → hold → QR transfer → "My bookings" |
| Tickets + delivery (T7), passenger list (T8), platform fees (T9), worker (T10), admin web (T12) | ⏳ Not started |

Details and newly found issues: [task.md](task.md). Working conventions: [CLAUDE.md](CLAUDE.md).

## Layout

```
apps/
  api/        NestJS 11 + PostgreSQL (plain SQL via `pg`, migrations in src/db/migrations)
  miniapp/    Zalo Mini App: React 18 + ZMP UI/SDK, React Router 7, TanStack Query, Zustand, Tailwind
docs/         Product spec and decisions
prototype/    Static UI prototype (seat picker)
templates/    Sample files (per-trip passenger list in Excel)
Images/       Photos of real seat plans used to build the layout library
```

## Running locally

### 1. Requirements

- Node.js 22+ and pnpm 10 (`packageManager: pnpm@10.28.0`)
- A running PostgreSQL 14+

```bash
pnpm install
```

### 2. Database

```bash
createdb pnticket_dev
```

Set the environment in every terminal that runs the API. Both secrets must be **at least 32 characters** (the values below are for development only):

```bash
export DATABASE_URL="postgres://localhost/pnticket_dev" BOOKING_TOKEN_SECRET=dev-only-booking-secret-0123456789abcdef AUTH_TOKEN_SECRET=dev-only-auth-secret-0123456789abcdefgh
```

> Homebrew PostgreSQL listens on a socket only: use `postgres://localhost/pnticket_dev?host=/tmp`.

```bash
pnpm --filter api migrate
```

### 3. Sample data

```bash
pnpm --filter api seed
```

Creates operator `PN` (two default vehicles: 24-room limousine, 40-berth sleeper), route `HCM-HA` and two trips tomorrow.

> ⚠️ **Known issue** (logged in `task.md`): `scripts/seed.ts` still prices floors `A`/`B`, but layouts now use floors `1`/`2`, so the seed fails with `VALIDATION_FAILED`. Until it is fixed, change `floor: 'A'` → `'1'` and `floor: 'B'` → `'2'` in that file. If the broken seed already ran once (the operator exists), drop and recreate the database and run `migrate` again before seeding.

### 4. Run the API

Use port **3001** (port 3000 is used by the Mini App's `zmp start`):

```bash
pnpm --filter api build && PORT=3001 pnpm --filter api start
```

Check it:

```bash
curl "http://localhost:3001/api/v1/operators/PN/trips?date=$(TZ=Asia/Ho_Chi_Minh date +%F)"
```

Behind a proxy or load balancer you **must** set `TRUST_PROXY` (see `CLAUDE.md`).

### 5. Run the Mini App

```bash
cp apps/miniapp/.env.example apps/miniapp/.env
```

```bash
pnpm --filter miniapp dev
```

Open http://localhost:5173 (narrow the browser to phone width). Vite forwards `/api` to `VITE_API_PROXY_TARGET` (default `http://localhost:3001`) because the API does not enable CORS yet.

Through the Zalo Mini App CLI (requires `zmp-cli` and a login):

```bash
pnpm --filter miniapp start
```

Settings in `apps/miniapp/.env`: `VITE_OPERATOR_CODE`, `VITE_OPERATOR_NAME` (one Mini App build per operator), `VITE_API_BASE_URL` (for release builds). See [apps/miniapp/README.md](apps/miniapp/README.md) (Vietnamese).

### 6. Trying the payment flow without SePay

A hold expires after `holdMinutes` (10 minutes by default). The QR screen appears only once the operator has a payout account configured (admin `payment-account` API). To see the "Confirmed" state on a development database:

```bash
psql "$DATABASE_URL" -c "update bookings set status='CONFIRMED', paid_amount=total_amount, payment_status='PAID' where code='BOOKING_CODE'"
```

## Checks

```bash
pnpm -r typecheck
```

```bash
pnpm --filter miniapp test
```

API tests are unit + integration against a real PostgreSQL. Integration tests **wipe the `public` schema** of the test database — never point them at a real database:

```bash
createdb pnticket_test && DATABASE_URL_TEST="postgres://localhost/pnticket_test" pnpm --filter api test
```

(default `DATABASE_URL_TEST=postgres://pnticket:pnticket@localhost:5432/pnticket_test`)

## Documents (Vietnamese)

- 📘 [docs/PNTicketDocs.md](docs/PNTicketDocs.md) — Product direction and implementation spec (**main document**).
- 📝 [docs/GOP-Y-PNTicketDocs.md](docs/GOP-Y-PNTicketDocs.md) — Review notes, risks and additions to v0.1.
- 📱 [docs/ZALO-MINI-APP.md](docs/ZALO-MINI-APP.md) — Zalo Mini App as the passenger channel (ZNS, Checkout SDK, pickup map).
- 🏢 [docs/NEN-TANG-DA-NHA-XE.md](docs/NEN-TANG-DA-NHA-XE.md) — Multiple operators, low-cost payments, single/double limousine rooms, per-trip passenger list (Excel).
- ✅ [docs/SETUP-NHA-XE.md](docs/SETUP-NHA-XE.md) — Operator fees, free-first ticket delivery, child policy, operator setup checklist.
- 🔐 [docs/PHAN-QUYEN.md](docs/PHAN-QUYEN.md) — Permissions by account role.
- 🚌 [docs/DOI-XE-SO-DO-CHO.md](docs/DOI-XE-SO-DO-CHO.md) — Fleet, berth/seat layout templates, seat code and status conventions.

## UI prototype

- [prototype/so-do-cho.html](prototype/so-do-cho.html) — Seat picker based on the real plans in `Images/` (24-room single/double limousine, 40-berth sleeper, seater), with infants under 2. Open it directly in a browser.
- [templates/mau-danh-sach-khach-theo-chuyen.xlsx](templates/mau-danh-sach-khach-theo-chuyen.xlsx) — Sample per-trip passenger list for the conductor.
