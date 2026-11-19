# PNTicket — Coach ticket booking on Zalo Mini App

🇻🇳 [Tiếng Việt](README.md) · 🇬🇧 English

A **multi-operator** booking platform for sleeper and limousine coaches: passengers pick a seat and pay by bank transfer inside Zalo; operators manage trips, seat inventory, deposits, boarding and reconciliation. Phong Nhung (`PN`) is the first operator.

This repo holds the **API** and the **Zalo Mini App**. The operator dashboard lives in [BusTicket-DashboardAdmin](https://github.com/dinhxuanhieu97/BusTicket-DashboardAdmin).

> Product docs (`docs/`), `task.md` and `CLAUDE.md` are in Vietnamese. Code, identifiers and commit messages are in English.

## Features

**Passengers (Mini App)**
- Search trips by date/route, real per-deck seat maps (sleepers, single/double limousine cabins), infants under 2.
- Timed seat holds, pickup/drop-off stops, deposit or full payment by QR bank transfer; bookings confirm automatically when money arrives.
- My bookings, downloadable/shareable receipts, signed ticket-verification QR.

**Operators (admin API)**
- Routes, stops, fleet, seat-layout library, fares by deck/occupancy, recurring schedules that generate trips.
- Counter sales, Excel passenger import, booking edits (contact, stops, note), cancellations and refunds.
- Payment ledger: manual cash/bank entries, allocation to bookings, late-payment handling.
- Trip assistants see assigned trips and board passengers seat by seat.
- Role-based access (Owner, Dispatcher, Seller, Accountant, Assistant, Platform admin), 2FA, audit log.

**Invariants**
- PostgreSQL is the source of truth: a seat on a trip has at most one claim (row lock + primary key).
- Every query is scoped to the operator resolved server-side; public endpoints never return passenger names or phones.
- Money is integer VND; prices and policies are snapshotted into the booking. Money writes use `Idempotency-Key`.
- Timestamps are UTC; business dates use `Asia/Ho_Chi_Minh`.

## Stack

| Part | Tech |
|---|---|
| `apps/api` | NestJS 11, PostgreSQL 14+ (plain SQL via `pg`, migrations in `src/db/migrations`), Zod, Jest |
| `apps/miniapp` | React 18, ZMP UI/SDK, React Router 7, TanStack Query, Zustand, Tailwind, Vite |
| Infra | Railway (auto-deploys `main`), GitHub Actions |

## Run locally

Requires Node.js 22+, pnpm 10, PostgreSQL 14+.

```bash
pnpm install
createdb pnticket_dev
export DATABASE_URL="postgres://localhost/pnticket_dev" BOOKING_TOKEN_SECRET=dev-only-booking-secret-0123456789abcdef AUTH_TOKEN_SECRET=dev-only-auth-secret-0123456789abcdefgh
pnpm --filter api migrate
pnpm --filter api seed
pnpm --filter api seed:demo -- --days=7   # optional demo data (add --yes for a non-local DB, --remove to delete it)
pnpm --filter api build && PORT=3001 pnpm --filter api start
```

Mini App in a browser (Vite proxies `/api` to `VITE_API_PROXY_TARGET`, default `http://localhost:3001`):

```bash
cp apps/miniapp/.env.example apps/miniapp/.env
pnpm --filter miniapp dev
```

Environment variables, the platform-admin bootstrap command and production setup are described in [README.md](README.md) and [DEPLOY.md](DEPLOY.md).

## Tests

```bash
pnpm -r typecheck
pnpm --filter miniapp test
createdb pnticket_test && DATABASE_URL_TEST="postgres://localhost/pnticket_test" pnpm --filter api test
```

Integration tests **wipe the `public` schema** of the test database — never point `DATABASE_URL_TEST` at real data.

## License

No open-source license has been published; all rights reserved by the repository owner.
