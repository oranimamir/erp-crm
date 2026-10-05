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
- Auth: JWT via `req.user.userId`; `authenticateToken` re-reads the user row each request (deleted user → 401, role from DB, not the token)
- Migrations: try/catch `ALTER TABLE` at bottom of `initializeDatabase()`
- Currency: store `amount` + `currency` + `fx_rate` + `eur_amount`; aggregate via `COALESCE(eur_amount, amount)`; display EUR throughout
- Theme: Zoho-CRM style tokens (primary blue, slate greys, radii, Lato) in `client/src/index.css` `@theme` — restyle there, don't move controls
- Dates: use `formatDate()` from `client/src/lib/dates.ts` (DD/MM/YYYY)

## Security
- No public sign-up: accounts come from admin create or invite only; login is password + emailed OTP (5 wrong codes burn it; compare dates with `datetime(expires_at)`)
- 401 means "session gone" (client logs out) — use 400 for a wrong password/code inside a valid session
- Any file name taken from a request must match `^[a-zA-Z0-9._-]+$` before it is stored, served or unlinked
- `/api/files` renders only PDF/images inline; other types download. CSP set in `index.ts` helmet — new external hosts must be added there
- User-entered text in email HTML goes through an escape helper
- Update endpoints: a field left out keeps its stored value, a field sent blank clears it

## Wire Transfers
- `POST /invoices/:id/wire-transfers` — upload + mark invoice paid; fetches FX on upload date, stores `fx_rate` + `eur_amount`
- `DELETE /invoices/:id/wire-transfers/:transferId` — reverts invoice to `sent`
- No approval workflow; no confirmation modals (inline drag-drop IS the confirm)

## Operations
- `operations.category`: 'blending' | 'trading' (required for new operations)
- List filter All / BE / NL — entity read off the operation number (`entityFromOperationNumber`)
- Change emails: Settings → Operation change emails (`app_settings.operation_notifications`, `/api/settings/operation-notifications`, admin) — `notifyAdmin` with an `Operation…` entity also emails these recipients (not the person who acted), with what changed in `detail` (`describeChanges` in `routes/operations.ts`)
- Supplier Purchase Order via `/api/purchase-orders` (any order, not only trading ops) — Order Confirmation template, entity from operation number, filed as `<op#>PO.pdf`, prices entered by hand

## Document Generators (OC, supplier PO, invoice, PL)
- Generated from an order: `DocumentGenerators` (operation page + order page) shows each as none / (draft) / ✓
- OC, PO, invoice: `status` 'draft' | 'final' — "Save draft" keeps the form only (no PDF, not filed); "Confirm & generate" files the PDF under the operation; never back to draft
- Save draft on an already generated OC / PO / invoice stores the edits in `draft_data` (API returns it as `draft`); the filed PDF and recorded amount stay until Confirm & regenerate, which clears it
- Compare buttons via `CompareButtons` (grey when the document is missing or still a draft): OC → order; PO → order, OC; invoice → order, OC, BL (`GET /api/operations/:id/bill-of-lading`); PL → order, OC, invoice, BL
- PDFs leave off any table column nobody filled in (line/reference/name always kept) and the Terms heading when there are no terms
- Operation page: eye icons beside each generator open its filed PDF (PL: final, else draft)
- Invoice "Our ref" = the operation number
- Default email recipients (To/CC) for invoices and PLs: Settings → Document emails, `app_settings.document_emails` via `/api/settings/document-emails`; pre-filled in both Send by email dialogs (PL: `POST /api/packing-lists/:id/email`, final PDF else draft)

## Generated Invoices
- `/api/invoice-documents`; each is also filed as an `invoices` row (`invoice_documents.invoice_id`, PDF copied to `uploads/invoices`) so it shows in the operation's Invoices and quick view; re-save updates it, delete removes it unless wired
- `invoice_documents.status` 'draft' | 'final': "Save draft" keeps the form + number only (no PDF, not filed, not in revenue); generating turns it final (never back)
- Deleting the recorded invoice (Invoices list) or its operation document deletes the generated invoice too (`deleteInvoiceDocument`), freeing the number; startup removes rows whose recorded invoice is gone. A taken number on generate/draft is renumbered to the series max + 1 (`renumbered_from`)
- Drafted from the order's latest OC (`OC_CARRIED_FIELDS` + lines), order/profile fill its blanks; "Compare with OC" beside "Compare with order"
- Line table uses one font size for every cell; optional `lot2` prints under `lot`; client block prints contact person, phone and email
- Document forms (invoice/OC/PO): Tab on an empty field accepts its grey placeholder (`client/src/lib/placeholderTab.ts`)

## Packing Lists
- `/api/packing-lists`, page `/packing-lists/:id`; built from a generated invoice (`invoice_document_id`), numbered `<operation#>PL`, filed under the operation documents ("Packing list")
- Packaging per line from Inventory → Packaging (`packaging` table) via `server/src/lib/packing.ts`: code token in the reference (BU25, DU25…) + longest product-name match; ties offered in a dropdown
- Weights (user's definitions): unit Net = product_mass (content); unit Gross = content + weight_packaging; Pallet net = units/pallet × unit net; Pallet gross = units/pallet × unit gross + pallet (20 kg default, per-line `pallet_weight_override`); line gross = net + units × packaging + pallets × pallet weight. units = ceil(net / product_mass), pallets = ceil(units / units_per_pallet); units/pallets overridable; server recomputes on save
- Per-customer layout (`server/src/lib/packingListLayout.ts`, seeds read off the issued PLs): heading, header rows, column names/order, CBM column, kg or lb, HS code line/panel, origin, terms. Resolves profile `packing_list_layout` → last PL for the customer → seed → default; "Save as this customer's format" = `PUT /api/packing-lists/layout/:profileId`. Stored on the PL as `data.layout`
- Deleted with its invoice
- Draft → final: `packing_lists.status`; the draft PDF (`file_path`, `document_id`) is watermarked DRAFT and filed as `<op#>PL-DRAFT.pdf`; finalizing saves the form as the draft, then renders the clean `<op#>PL.pdf` into `final_file_path` / `final_document_id` as its own operation document; the draft stays. Allowed without a BL (warns); saving edits reverts to draft (final kept until re-finalized); `POST /:id/reopen`; `/:id/pdf?version=draft|final`
- Always filed under the operation (invoice's operation, else the order's); BL found by "Bill of Lading" category or BL in name/notes (`findBillOfLading`); "Compare with BL" uses `OrderCompareModal` `left` prop

## Backups
- Server ZIP on a schedule (`lib/backup-scheduler.ts`, Settings → Backup), plus the weekly email (`lib/backupEmail.ts`): Monday 06:00 Europe/Brussels by default; admin sets recipients (typed, or ticked from app users) and parts (database / all uploads / invoices by category / operations) at `/api/backup/email`; one ZIP per part, parts > 25 MB are named, not attached (Resend limit). Operations = `Operations/<op#> - <customer>/` (Order, documents by category, uploaded invoices) + `Operations overview.xlsx`, split into ~22 MB ZIPs by whole operation (`writeBackupPart` returns several paths)

## TripleW Entities
- Table `company_entities` (edited on the TripleW Details page, `/api/company-entities`); `server/src/lib/companyEntity.ts`
- Entity picked from the operation number (`SO<code>…`), default entity otherwise
- Each entity has one or more banks (`company_entities.banks` JSON + `default_bank`), each with a USD and a EUR account; the default bank is mirrored into the bank columns, and `applyEntityBank()` prints its account matching the document currency (skipped when `bank_override` — customer-profile bank)
- Read by everyone, changed by admins only (server `requireAdmin`; the page is read-only for other users)

## Customers & Suppliers
- Customer page: Summary | Details. Details = per-entity profiles (`customer_document_profiles`), the source for OC/invoice customer details; the default entity is mirrored onto the `customers` row
- Invoice drafts use the entity confirmed on the order's OC (`order_confirmations.profile_id`)
- Supplier page: Summary | Details (edits the `suppliers` row, which the supplier PO reads)
- `lib/partyDetails.ts` reads a party's details off a PDF with Claude (cached in `party_extractions`); used once to seed the records

## Supplier Invoices (`/api/demo-expenses`, `demo_invoices`)
- PDFs read by Claude first (`lib/supplierInvoiceReader.ts`, cached in `invoice_extractions` by file sha256), regex `parsePDFInvoice` as fallback; UBL XML parsed directly. `checkAmounts` flags net + VAT ≠ total, odd rates, foreign VAT → upload review warnings
- Supplier allocation `lib/supplierMatch.ts`: VAT no. → name (exact / whole-word / near spelling) over mappings > Suppliers (sales) > earlier invoices > built-in demo list → Claude's pick. Short names match whole words only
- Stored: `supplier_vat`, `supplier_country`, `vat_rate`, `parse_source`, `parse_warnings`; remembered mappings keep the VAT no.
- AI reading is cheapest-first: PDF text → Haiku (`haiku-text`); only scans / readings that don't add up → PDF to Sonnet (`sonnet-pdf`). Forced tool call (`record_invoice`) for JSON. Every call's tokens + approx. cost in `ai_usage`
- Full check (Summary → Full check, `InvoiceFullCheck.tsx`, `lib/invoiceCheck.ts`): ONE run (`POST /full-check/run` → `check_runs`) that the server moves on by itself: `text` (free: stored net/VAT/total/currency/number/date/supplier searched in the PDF text → `invoice_triage`, `invoice_texts`) → `ai_text` (Haiku batch, half price) → `ai_pdf` (Sonnet batch for scans / text readings that don't add up) → `done` | `stopped` (reason in `message`). `advanceRun` runs after the text check and every 2 min with the batch poller; survives restarts. The user sees progress, then the result list: Fix (`POST /invoices/:id/apply-check`), Correct as stored, Quick view
- `PATCH /invoices/:id/vat` with optional `amount` changes net + VAT together (FX redone; used by the inline edit). No separate VAT audit: the full check covers it — invoices without a PDF get VAT-rule suggestions (`vatRuleSuggestion`), flagged rows can be marked "Correct as stored" (`POST /invoices/:id/accept-check` → `invoice_check_accepted`, holds until the figures change)
- Check Duplicates (`GET /check-duplicates`) also uses the full check's readings: same file, or same seller (VAT no.) + same printed invoice number → duplicate; both read with different printed numbers from the same seller → never flagged. No AI calls of its own
- Scope: Full check (triage, batches, report) and Check Duplicates take `domain` = demo | sales (omitted = all); `ScopeSwitch` in `InvoiceFullCheck.tsx`, shared on the Summary tab
- Uploads save their reading in `invoice_extractions` (AI for PDFs; e-invoice XML data as `read_by: 'xml'` via `rememberUblReading`), so the full check confirms them without new AI calls. `sendStage` allows one send at a time (concurrent users)
- No AI reading on upload (no credit / no key / error) → basic regex reader, `ai_unavailable` warning on the invoice + `aiUnavailable {count, reason}` on the ZIP response; review shows a red banner. After a credit error AI is skipped for 5 min (`creditOutUntil`)
- Monthly AI spending limit (Settings → AI invoice reading, `app_settings.ai_monthly_limit_usd`, default $10; `lib/aiBudget.ts`): spend = this month's `ai_usage` + open batch estimates. Uploads get `aiProblem: 'limit'`; runs send only what fits and note the rest
- Uploads run the same order: step 1 free (`verifyBasicReading`: the basic reader's figures confirmed by the PDF text AND exactly one known supplier VAT no. printed; credit notes excluded) → Haiku on text → Sonnet on PDF. `learnSupplierVats` stores suppliers' VAT numbers from readings when a run finishes
- Duplicates on upload (ZIP, single, import guard) — `findDuplicate` / `buildDuplicateIndex`: same file → skip; same invoice number (stored or printed, compacted) + same supplier (VAT no. / name) or amount or date → skip; same supplier + amount + date otherwise → review as `possible_duplicate` (pre-skipped, user can include). Two numbers read off the documents that differ → never a duplicate. Same rules inside one ZIP

## Dashboard
- Monthly Cash Flow: paid out = sales-activity supplier invoices only (`paid_out_sales`); working capital shows only as planned amounts from the current month onward, never in past months
- Demo Expenses chart: Salaries / Cars checkboxes (`/dashboard/demo-expenses-monthly` returns their share per month; choice kept in localStorage)

## Analytics
- "Based on" Orders | Invoices (`basis` in `AnalyticsPage.tsx`) applies to the whole page: Tonnage (`GET /api/analytics/quantity?basis=`), Trading sale side (`/trading?basis=`), the revenue compared with expenses, and it moves with the Revenue Orders / Invoices sub-tabs (Summary always shows both)
- Tonnage on invoices (by invoice date): generated invoice lines, else the invoice's `quantity_mt` shared over the operation's order lines, else "Unspecified product"; on orders: customer order lines by order date. Both give month / customer / region / product
- Trading on invoices: operations with a customer invoice in the period; sale = invoice amounts (lines only from generated invoices)

## Deployment
Railway, auto-deploys from `main` on push. Commit and push immediately after every change.
