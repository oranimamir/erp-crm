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

## Operations
- `operations.category`: 'blending' | 'trading' (required for new operations)
- List filter All / BE / NL — entity read off the operation number (`entityFromOperationNumber`)
- Trading ops: supplier Purchase Order via `/api/purchase-orders` — Order Confirmation template, entity from operation number, filed as `<op#>PO.pdf`, prices entered by hand

## Generated Invoices
- `/api/invoice-documents`; each is also filed as an `invoices` row (`invoice_documents.invoice_id`, PDF copied to `uploads/invoices`) so it shows in the operation's Invoices and quick view; re-save updates it, delete removes it unless wired
- Line table uses one font size for every cell; optional `lot2` prints under `lot`; client block prints contact person, phone and email
- Document forms (invoice/OC/PO): Tab on an empty field accepts its grey placeholder (`client/src/lib/placeholderTab.ts`)

## TripleW Entities
- Table `company_entities` (edited on the TripleW Details page, `/api/company-entities`); `server/src/lib/companyEntity.ts`
- Entity picked from the operation number (`SO<code>…`), default entity otherwise
- Each entity has a USD and a EUR account; `applyEntityBank()` prints the one matching the document currency (skipped when `bank_override` — customer-profile bank)

## Customers & Suppliers
- Customer page: Summary | Details. Details = per-entity profiles (`customer_document_profiles`), the source for OC/invoice customer details; the default entity is mirrored onto the `customers` row
- Invoice drafts use the entity confirmed on the order's OC (`order_confirmations.profile_id`)
- Supplier page: Summary | Details (edits the `suppliers` row, which the supplier PO reads)
- `lib/partyDetails.ts` reads a party's details off a PDF with Claude (cached in `party_extractions`); used once to seed the records

## Deployment
Railway, auto-deploys from `main` on push. Commit and push immediately after every change.
