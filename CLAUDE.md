# ERP-CRM
React + TS + Vite client / Node + Express + TS server. sql.js (SQLite in-memory + file persist). JWT auth.

## Structure
- `server/src/` — index.ts, database.ts, routes/, middleware/, lib/, types/
- `client/src/` — App.tsx, main.tsx, pages/, components/, contexts/, lib/
- `server/uploads/` — invoices, wire-transfers, orders, operation-docs
- `server/data/` — SQLite file persistence

## Commands
- Dev server: `npm run dev:server` (tsx watch)
- Dev client: `npm run dev:client` (vite)
- Build: `npm run build` (client vite build + server install)
- Start: `npm run start`

## Key Modules
- `server/src/database.ts` — sql.js wrapper; `db.prepare(...).run/get/all()` (better-sqlite3-like API)
- `server/src/lib/fx.ts` — Frankfurter API FX rates, in-memory cache per process
- `client/src/lib/api.ts` — axios, base `/api`
- `client/src/lib/dates.ts` — `formatDate()` returns DD/MM/YYYY (EU format)

## Patterns
- Auth: JWT via `req.user.userId`
- Migrations: try/catch `ALTER TABLE` at bottom of `initializeDatabase()`
- Currency: store `amount` + `currency` + `fx_rate` + `eur_amount`; aggregate via `COALESCE(eur_amount, amount)`; display EUR throughout
- Dates: use `formatDate()` from `client/src/lib/dates.ts` (DD/MM/YYYY)

## Wire Transfers
- `POST /invoices/:id/wire-transfers` — upload + mark invoice paid; fetches FX on upload date, stores `fx_rate` + `eur_amount`
- `DELETE /invoices/:id/wire-transfers/:transferId` — reverts invoice to `sent`
- No approval workflow; no confirmation modals (inline drag-drop IS the confirm)

## Deployment
Railway, auto-deploys from `main` on push. Commit and push immediately after every change.
