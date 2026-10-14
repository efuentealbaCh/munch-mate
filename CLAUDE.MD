# Development Guide — Claude Code

## Stack: Next.js + NestJS + BullMQ + MongoDB — self-hosted on a VPS with Docker Compose

> Use this file as the initial context in Claude Code.
> Everything runs in Docker containers: what is tested locally is exactly what runs on the VPS.
> No cloud-provider services (AWS, GCP, Azure) are required.

---

## Product context

Multi-tenant SaaS for restaurant orders: **dine-in via table QR**, **pickup** and **delivery**, with a live kitchen board and real-time order tracking. Full product definition, data model and roadmap: [`docs/PRODUCT.md`](docs/PRODUCT.md) — read it before working on any feature.

Domain rules that always apply:

- **Tenant isolation**: every tenant-scoped collection has `restaurantId`, and repositories always filter by it (it is the first parameter of every tenant-scoped repository method). Never trust a `restaurantId` sent by the client — take it from the authenticated membership or the resolved public slug.
- **Tenant routes** live under `/api/restaurants/:restaurantId/...` and use `@UseGuards(RestaurantAccessGuard)` (+ `@RestaurantRoles(...)` when only some roles may act); handlers read the tenant with `@CurrentTenant()`. Non-members get **404** `RESTAURANT_NOT_FOUND` (never 403), so other tenants cannot be probed; members without the role get 403 `FORBIDDEN_ROLE`; suspended restaurants are read-only.
- **A restaurant always has at least one owner.** Any change to memberships goes through `MembersService` (transaction + `membershipVersion` bump, which prevents two owners demoting each other at once).
- **Menu permissions**: reading the admin menu → any member; marking products/options "agotado" (`available`) → owner, cashier, kitchen; everything else (prices, names, photos, categories, modifier groups, order) → owner only.
- **Modifier groups are a reusable library**: products reference them by id (`modifierGroupIds`, in display order); editing a group affects every product using it. References to categories or groups must belong to the same restaurant (rejected with 400 otherwise). Options keep their ids across edits.
- **Two flags on products**: `available=false` = "Agotado" (shown, not orderable); `visible=false` = hidden from the public menu. Categories have `active`. The public menu (`GET /api/public/restaurants/:slug/menu`) only shows active categories, visible products and non-empty categories.
- **Money as integers** in the currency's minor unit, always stored with `currency`. Never use floating point for amounts.
- **Order items are price snapshots**; the server computes all totals from current product data — clients only send IDs and quantities.
- **Order status changes go through the state machine** (invalid transition → 409) and are recorded in `statusHistory`.
- Guest orders are accessed only with their `accessToken`, never by order number alone. The token is derived (HMAC with `ORDER_TOKEN_SECRET`) from the browser's `clientOrderId`, only its hash is stored, and it always travels in request bodies (`/api/public/orders/lookup`), never in api URLs.
- **Order creation is idempotent per `clientOrderId`**: a retried submission returns the same order and token. Carts are priced by `priceOrder()` (`modules/orders/order-pricing.ts`) against the current menu — sold-out items, hidden products and modifier rules are enforced there.
- **The state machine lives in `@app/utils` (`checkTransition` / `nextStatuses`)**, shared by the api (enforcement) and the web (which buttons to show). Transitions use a conditional update on the current status, so two staff members cannot apply conflicting changes (409 `ORDER_CHANGED`).
- **Editing an order** (`PUT /api/restaurants/:id/orders/:orderId/items`, body `{ revision, keep: [{ line, quantity }], add: OrderItemInput[], reason? }`): staff only, with the roles that work the channel (`canEditOrder` in `@app/utils`: waiters only table orders, riders never → 403 `FORBIDDEN_ROLE`), only while `pending`/`accepted` (`isOrderEditable`, 409 `ORDER_NOT_EDITABLE`) and unpaid (409 `ORDER_ALREADY_PAID`). Lines not in `keep` are removed; kept lines keep their price snapshot (`lineTotal` scaled to the new quantity), added lines are priced by `priceOrder()` against the current menu (same 409s as a new order) and go last; logic in `modules/orders/order-edit.ts`. Same `TOO_MANY_ITEMS` and (while the zone exists) `BELOW_MINIMUM_ORDER` checks as creating; the delivery fee stays; a `cashAmount` below the new total is cleared. Not checked: open switch/schedule. 400 `INVALID_EDIT` (repeated/unknown line), `ORDER_EMPTY`, `NOTHING_CHANGED`. `orders.revision` (missing = 0) is the concurrency check: a stale `revision`, or a status/payment/edit change between read and write (conditional `findOneAndUpdate`), → 409 `ORDER_CHANGED`. Each edit is stored in `orders.edits` (`at`, `byUserId`, `byName`, `reason`, server-written Spanish `changes`); staff see `revision` + `edits` in `OrderView`, the customer only `PublicOrderView.editedAt`. An accepted pickup/delivery order gets its receipt again: receipt key and job id are per revision (`<orderId>-r<n>.pdf`, `receipt-<orderId>-r<n>`; revision 0 keeps the original names), never re-emailed; the previous PDF is deleted best effort unless the customer left an email (it may be the pending confirmation's attachment). No push or WhatsApp notice for edits.
- **Pickup orders** (`POST /api/public/restaurants/:slug/orders`) need the owner setting `pickupEnabled` plus the open switch. Name and phone are mandatory, email optional; phones are stored normalized with `normalizePhone()` (`@app/utils`, Chile by default) and at most `ORDER_LIMITS.activePickupOrdersPerPhone` pickup orders per phone may be in progress (429 `TOO_MANY_ACTIVE_ORDERS`). Accepting one requires `readyInMinutes` (`PICKUP_READY_MINUTES`), stored as `estimatedReadyAt`. Handing over an unpaid order is allowed (the web warns).
- **Delivery orders** (`POST /api/public/restaurants/:slug/delivery-orders`) need `deliveryEnabled`, an active `delivery_zones` entry of the same restaurant (it fixes `deliveryFee` and the minimum subtotal, 409 `BELOW_MINIMUM_ORDER`) and the same contact rules as pickup. `total = subtotal + deliveryFee`. The zone name and address are snapshotted on the order; `expectedPayment` (method, optional `cashAmount` ≥ total) lets the rider bring change. One zone per restaurant may be `isHome` (preselected at checkout; the service unmarks the previous one). Accepting asks for an arrival time (`DELIVERY_ETA_MINUTES`).
- **Riders** are optional: owner/cashier assign one with `PUT .../orders/:orderId/rider` (members with the `rider` role only, `GET .../riders`). A rider works only through `/restaurants/:id/deliveries` and only on deliveries assigned to them (403 `NOT_YOUR_DELIVERY`): take it out, collect the payment, deliver. Without a rider, the floor staff do those steps.
- **Opening hours**: `restaurants.openingHours` is 7 days (Monday first), up to 2 ranges per day, `HH:MM` in the restaurant timezone; a close not after the open ends the next day. null = no schedule. Customers can order only with the manual switch on **and** inside the schedule (409 `OUTSIDE_OPENING_HOURS` with `meta.nextOpeningAt`). The rules (`isOpenAt`, `nextOpeningAt`, `openingHoursProblem`) live in `@app/utils`; the api exposes `openState` in `RestaurantView`, `PublicMenu` and `TableContext`.
- **Daily summary**: `GET .../reports/daily?date=YYYY-MM-DD` (owner, cashier), computed by `summarizeDay()` from the day's orders; rejected and cancelled orders are counted but never summed.
- **Platform admin**: `users.platformRole = "admin"`, checked from the database on every request by `PlatformAdminGuard` (others get 404). Routes under `/api/platform/*`: list/search restaurants, suspend/reactivate (suspending also turns the switch off). Grant it with `pnpm platform:admin <email>` (`--revoke` to remove).
- **Unique names within a restaurant**: table labels, delivery zones, categories, and products within their category cannot repeat (409 `TABLE_LABEL_TAKEN`, `ZONE_NAME_TAKEN`, `CATEGORY_NAME_TAKEN`, `PRODUCT_NAME_TAKEN`). Names are compared with `nameKey()` / `isNameTaken()` (`@app/utils`: case, accents and extra spaces ignored), checked in the services against the restaurant's list (no unique index, so existing data needs no migration). An item may always keep its own name when edited, so duplicates created before the rule can still be edited. Modifier groups may share names on purpose (two "Tamaño" groups with different options).
- **Phones** (customers and restaurants) are stored normalized with `normalizePhone()` (`+56912345678`, 400 `INVALID_PHONE`) and shown with `formatPhone()` in the Chilean mobile style `+569 12345678`; inputs format as you type with `formatPhoneInput()`.
- **Cancelling needs a reason from the staff** (like rejecting, 400 `REASON_REQUIRED`); the customer sees it as `PublicOrderView.cancelReason` through the `order.status` event (customer cancellations read "Cancelado por el cliente").
- **Free text is cleaned before validation** with `@Transform(cleanLine)` (names, labels, addresses: one space between words, no line breaks) or `@Transform(cleanText)` (notes, descriptions, reasons: keeps line breaks, at most one blank line) from `common/validation/clean-text.ts`. Both strip invisible characters (zero-width, BOM, controls), so length limits count real characters and a required field made of blanks is empty. Use them on every new text field; never on passwords.
- **Items per order**: the owner sets `maxItemsPerOrder` (units = sum of quantities; default 50, 1–500). Bigger carts get 409 `TOO_MANY_ITEMS` (`meta.max`); the value is public in `PublicMenu` and `TableContext` so the cart enforces it too.
- **Report dates** must be real calendar days (`isCalendarDate`, 400 `INVALID_DATE`) and not after today in the restaurant's timezone (400 `FUTURE_DATE`).
- **Maps (phase 7)**: self-hosted, no map provider or API key. `pnpm maps:init` extracts Chile from the Protomaps planet build (PMTiles, OpenStreetMap data) plus the basemap fonts/sprites, and uploads them to the private bucket under `maps/`. The api serves them same-origin at `/api/public/maps/*` with HTTP Range (`MapsService` only allows the archive, `fonts/…` and `sprites/…`); `GET /api/public/map-config` says whether the map is `available` — without it the web falls back to the zone list. The web renders with MapLibre GL + the `pmtiles` protocol.
- **Zones on the map**: a delivery zone may have an `area` (3–200 vertices, `geoAreaProblem` in `@app/utils`), stored as a GeoJSON Polygon with a sparse `2dsphere` index (MongoDB rejects self-crossing shapes → 400 `INVALID_ZONE_AREA`). `POST /api/public/restaurants/:slug/delivery-zones/locate` returns the zone containing a pin (first in display order when areas overlap; 404 `OUT_OF_DELIVERY_AREA`). A delivery to a zone with an area needs the customer's pin inside it (400 `LOCATION_REQUIRED`, 409 `OUTSIDE_ZONE`) while the base map is available; without the map the pin is optional (customers may have no way to place one) but a pin that is sent is still checked. Zones without an area keep working by name. Restaurants have an optional `location` (owner pin) to center maps. Coordinates are rounded to 6 decimals (`roundCoord`).
- **Rider tracking**: the assigned rider's phone emits `rider.location` over Socket.IO while the delivery is `out_for_delivery`; `RiderTrackingService` checks rider, membership and status on every report, drops reports closer than 3 s, keeps only the last position in Valkey (`cache:rider-location:<orderId>`, 15 min TTL) and emits `order.rider-location` to the customer's order room and the staff. The position is deleted when the delivery leaves `out_for_delivery`: no location history is stored. Last position on load: `POST /api/public/orders/rider-location` (token in body) and `GET .../orders/:orderId/rider-location`, both `{ position }`.
- **Customer accounts (phase 6)**: any account is also a customer (no separate sign-up). Public order routes read the session when there is one (`@OptionalUser()`; the access-token guard attaches a valid cookie on `@Public()` routes and ignores a missing/expired one) and store `customerId`, set by the controller — never from the body. `GET /api/me/orders` (opaque cursor `?before=<nextBefore>` = `<createdAt ISO>_<order id>`) is the customer's history across restaurants, with the derived tracking token of each order. `PATCH /api/me` (name, phone normalized) and `/api/me/addresses` (up to 10, unique labels, optional pin; user-scoped, not tenant-scoped).
- **Web push (phase 6, optional)**: VAPID keys from `pnpm push:keys` (api: public key; workers: both + subject). Without them nothing is enqueued and subscribing answers 400 `PUSH_NOT_CONFIGURED`. Subscriptions (`push_subscriptions`): user devices (`POST/DELETE /api/me/push-subscriptions`; staff and riders) and order followers (`POST /api/public/orders/push-subscription` with the tracking token; guests too; TTL 12 h). Endpoints must belong to a known browser push service (`isPushEndpointAllowed`, `@app/utils`): checked by the api and again by the workers, so a forged subscription cannot make the workers call internal hosts (SSRF). Events: new order → board staff (owner/cashier/kitchen); pickup `ready` and `out_for_delivery` → order followers; rider assigned → that rider. `PushService` enqueues `notif:push` with deterministic job ids and never fails the order flow; `NotifProcessor` sends with `web-push` and deletes subscriptions reported gone (404/410).
- **Waiters (phase 8)**: role `waiter` ("Garzón"). They work **table orders** (`dine_in` transitions in `@app/utils`; pickup/delivery stay with owner/cashier/kitchen → 403), register payments of table orders only (`markPaid`: `FORBIDDEN_ROLE` otherwise), see the board and "Salón", cannot open/close the restaurant, see sales or edit the menu. Waiter-only members land on `/admin/:id/salon`.
- **Table accounts (phase 8)**: `table_sessions` (tenant-scoped). Every dine-in order joins the table's **open account** inside the same transaction as the order (`getOrOpen`; a unique partial index allows one open account per table, `orders.tableSessionId`). The account adds up the orders (rejected/cancelled excluded, `billTotals` in `modules/orders/table-bill.ts`). From the QR, `GET /api/public/tables/:token/bill` (no names or ids), `POST .../call-waiter` (stamps `waiterCalledAt` once; it opens an empty account if needed) and `POST .../request-bill` `{ tip: TipChoice }` (409 `NOTHING_TO_PAY`, 400 `INVALID_TIP`). Staff (owner/cashier/waiter) at `/restaurants/:id/table-sessions`: list open, `POST :sessionId/attend` `{ kind: "waiter"|"bill" }`, `POST :sessionId/close` `{ method, tip }` — refused with 409 `TABLE_ORDERS_IN_PROGRESS` while an order is not final; it charges what is left as one payment `{ method, tip }` and, in one transaction, closes the account (conditional: two waiters cannot charge twice → 404) and pays every unpaid order. The next order opens a new account. Real time: staff get `table.updated`; phones that scanned the QR join `table:<tableId>` with `table.subscribe` (QR token) and get `table.bill`.
- **Split bills (phase 8)**: the staff (owner/cashier/waiter) split an open account in «Salón»: `PUT .../table-sessions/:sessionId/split` `{ mode: "equal", parts (2–20) } | { mode: "items" } | { mode: "amounts" } | { mode: null }` (409 `SPLIT_PARTS_PAID` with no more parts than equal parts already paid) and register partial payments, each with its own method and tip: `POST .../:sessionId/payments` `{ kind: "equal", part } | { kind: "items", items: [{ orderId, line, quantity }] } | { kind: "amount", amount }` + `{ method, tip }`. The server computes equal parts (`equalPartAmount` in `@app/utils`: floor of what is left over the pending parts, the last pending one takes the rest) and products (`itemsAmount`, `modules/orders/table-split.ts`, 400 `INVALID_SPLIT_ITEMS`); errors 409 `SPLIT_MODE_MISMATCH`, `SPLIT_PART_PAID`, `NOTHING_TO_PAY`, `PAYMENT_EXCEEDS_BALANCE` (`meta.remaining`). "What is left" = unpaid orders that count − payments (orders paid on their own stay out). Partial payments are allowed with orders in the kitchen; the payment that completes the bill closes the account in the same write (409 `TABLE_ORDERS_IN_PROGRESS` and nothing is recorded while an order is not final). `DELETE .../:sessionId/payments/:paymentId` only while open (409 `TABLE_SESSION_CLOSED`, 404 `TABLE_PAYMENT_NOT_FOUND`); `close` refuses an overpaid account (an order cancelled after paying, 409 `TABLE_OVERPAID`). Concurrency: `table_sessions.revision` is bumped by every payment, deletion, plan change and by edits/single payments of its orders; payments and plan changes are conditional on the revision read (409 `TABLE_SESSION_CHANGED`). With payments registered, the orders of the account cannot be edited or paid on their own (409 `TABLE_HAS_PAYMENTS`: payments by products point at lines by index). Closing splits the payments among the orders (`allocatePayments`: products first to their orders, then oldest first) into `orders.paymentBreakdown` (`paymentMethod` = largest portion); the account keeps `tip` (Σ payment tips), `paymentMethod` (null when several) and `paymentMethods`. Reports add each portion to its method; the orders CSV shows "Dividido (Efectivo $X · Tarjeta (POS) $Y)". Views: `TableSessionView` (`payments`, `paid`, `remaining`, `itemLines` per order line, `equalPart`) and `PublicTableBill` (same without names, ids or tips; `BillLine.paidQuantity`).
- **Tips (phase 8)**: only on table accounts. Owner setting `restaurants.tipPercent` (default 10, 0–30, 0 = no suggestion; Chile: voluntary, shown "con y sin propina"). The customer chooses the suggested %, another amount or none (`tipFromChoice`, `suggestedTip` in `@app/utils`); the waiter confirms the final amount when charging. Tips are stored on the closed account (`tip`, `closedBusinessDate`) and reported as `DailySummary.tips` / `SalesReport.tips`, **never** inside `sales.total`.
- **Product discounts (phase 8)**: `products.promo` = percent (1–90) or special price (< regular), optional weekdays (0 = Monday, [] = every day) and dates (inclusive, restaurant timezone), optional label. Owner only: `PUT/DELETE .../menu/products/:productId/promo` (400 `INVALID_PROMO` with `meta.problem`, rules in `promoProblem`); lowering the price below a special price → 409 `PROMO_PRICE_NOT_LOWER`. The public menu sends the regular `price` + `promo` + `timezone`; `priceOrder` and the web (`withPromos`) both use `promoPrice` (`@app/utils`) at ordering time, on the base price only (option extras are charged in full). Items snapshot `unitPrice` (charged), `regularUnitPrice` and `promoLabel`; reports sum `sales.discounts`.
- **Sales export (phase 8)**: `GET .../reports/sales?from&to` (`SalesReport`, one row per day, ≤ 366 days, 400 `INVALID_RANGE`/`RANGE_TOO_LONG`) and `GET .../reports/sales.csv?from&to&kind=orders|products|days` (owner, cashier): CSV for Excel in Spanish (`;`, UTF-8 BOM, amounts as integers, local times; text starting with `= + - @` is prefixed with `'` against CSV injection). The web also prints the range (`print:hidden` on the admin chrome).
- **Print agent (phase 8)**: direct ESC/POS printing through a self-contained agent on a restaurant computer (`apps/print-agent`, built separately) to USB (Windows queue, RAW) and network (TCP 9100) printers, 58/80 mm. Module `modules/printing/`; contract in `@app/types` (`printing.ts`) and `@app/utils` (`tickets.ts`).
  - **Pairing**: the owner gets a one-time code (`POST .../print-agents/pairing-code` → `{ code, expiresAt }`, 8 chars of `PAIRING_CODE_ALPHABET`, Valkey `cache:print-pair:<sha256(code)>`, 10 min, `GETDEL` = single use); the agent redeems it at `POST /api/print-agents/pair` (`@Public()`, 5/min per IP) `{ code, name, appVersion }` → `{ agentId, token, restaurantName }` (400 `INVALID_PAIRING_CODE`, 409 `TOO_MANY_PRINT_AGENTS`, max 10). The token (32 random bytes, base64url) is stored only as SHA-256 in `print_agents.tokenHash`. **Deliberate exception to "never tokens in response bodies"**: it is a device credential, not a browser session; it travels only to the agent over HTTPS and is kept on that computer.
  - **Owner routes** (`/restaurants/:id/print-agents`, owner): `GET` (`{ agents: PrintAgentView[] (online from Valkey presence), downloadUrl }`), `PATCH :agentId` `{ name }`, `PATCH :agentId/printers/:printerKey` (URL-encoded key; `enabled, paper, kitchen: off|new|accepted, categoryIds (same restaurant, 400 INVALID_CATEGORY), receipts, copies 1–3`), `POST :agentId/printers/:printerKey/test`, `DELETE :agentId/printers/:printerKey` (removes a printer that no longer exists → `PrintAgentView`, emits `agent.config`; reported again, it returns disabled with defaults), `DELETE :agentId` (revokes: `revokedAt`, pending jobs expire, `agent.revoked` + disconnect). `GET summary` for the board roles (`{ autoKitchen, receipts, online, offline }`: enabled + reported printers of paired agents, even offline ones, since jobs wait queued; `offline` = kitchen printers exist but none of their agents is connected, so the web warns), so the browser does not print twice. `GET jobs?status&limit` and `POST jobs/:jobId/retry` (owner, cashier; 409 `PRINT_JOB_NOT_RETRYABLE`/`PRINT_AGENT_REVOKED`). Board roles: `POST .../orders/:orderId/print` → `{ queued }` (reprint on purpose).
  - **Connection**: Socket.IO namespace `/print-agents` on the same server, `handshake.auth.token` (missing/unknown/revoked → `connect_error` "unauthorized"); agents send no `Origin` (allowed by the adapter, browsers of other origins are still rejected). Room `print-agent:<agentId>`. Events (`PRINT_AGENT_EVENTS`): `agent.hello` (reports printers, ack with the merged settings; pending jobs are re-sent after it), `agent.config`, `agent.revoked`, `print.job` (`PrintJobPayload` with `layout` = `PrintLine[]` already composed by `layoutTicket`), `print.result` (ack). Presence: Valkey sorted set `cache:print-agent-online:<agentId>` refreshed by Socket.IO pongs; `lastSeenAt` at most once a minute. Printers reported for the first time start disabled; settings are kept per key. Printers missing from a hello are kept with their settings and `reported: false` (an unplugged USB printer must not lose its rules): they get no jobs (treated as disabled, `enabled` unchanged) and their pending jobs expire; reported again, they recover everything.
  - **Jobs** (`print_jobs`, tenant-scoped, TTL 7 days): `PrintJobsService` queues kitchen tickets on order creation (rule "new") and acceptance ("accepted"), "MODIFICADO" tickets on edits only for printers that already printed or have queued a ticket of that order, and one payment receipt per payment ("Comprobante interno, no válido como boleta": `markPaid` and every table payment, including the one `close` creates). Per-printer category filter (no items left → no job, except edits). Unique `{ restaurantId, dedupeKey }` (`kitchen:<orderId>`, `kitchen:<orderId>:r<rev>`, `kitchen:<orderId>:m<ts>`, `receipt:<paymentId>`, `receipt:order:<orderId>`, `test:<ts>` + `:<agentId>:<printerKey>`) so an event never prints twice; agents must also deduplicate by `jobId` (re-sent after reconnecting). Pending kitchen/test tickets expire after 30 min, receipts after 24 h (checked when the agent says hello); failures and expiries reach the staff as `print.job-failed`. Copies apply to kitchen tickets only. Hooks never fail the order or payment (logged). Optional `PRINT_AGENT_DOWNLOAD_URL` (api) is the download button. Rule "off" = the printer prints no kitchen tickets (e.g. a cashier printer for receipts only); the manual "Comanda" goes to printers with any other rule. Category ids deleted from the menu are ignored; a filter left with none prints every item instead of going silent.
  - **Web**: tab «Impresoras» (`/admin/:id/impresoras`, owner; cashier sees only the failed jobs): download, pairing code with countdown, agents (online, rename, unpair) and per-printer settings saved on change (`lib/printers.ts`, tested). The board loads `summary` (`hooks/use-print-summary.ts`): banner "Las comandas salen por la impresora de cocina" (and a shortcut to turn the device's browser auto-print off, so nothing prints twice), an alert when `offline`, the "Comanda" button sends to the agent and falls back to the browser when `queued` is 0, and `print.job-failed` toasts with «Reintentar» for owner/cashier.
  - **Executable**: `build:exe` (Node SEA; icon, version info and manifest set with `resedit` before `postject`), `sign:exe` signs it with signtool when a certificate is configured (CI secrets `SIGN_PFX_BASE64`/`SIGN_PFX_PASSWORD`; without them it ships unsigned; see the agent README).
- **Thermal printing (phase 8)**: web only, through the browser's print dialog on any receipt printer installed in the device (58/80 mm). Kitchen tickets ("comanda", no prices) from the board and table pre-bills ("precuenta", tip suggested as voluntary) from "Salón": `lib/print.ts` (ticket model, tested) + `components/ticket-printer.tsx` (queue, `afterprint`, `#print-root` print CSS in `globals.css`). Per-device settings in localStorage: paper and auto-print (off / every new order / when accepted). Silent printing: Chrome `--kiosk-printing`. The ticket model and `kitchenTicket` live in `@app/utils` (`tickets.ts`, re-exported by `lib/print.ts`); the pre-bill stays in the web. Browser printing remains the fallback of the print agent (next bullet), which prints ESC/POS directly.
- **WhatsApp/SMS notices (phase 8)**: owner setting `restaurants.messaging` `{ enabled, channel: "whatsapp"|"sms", senderPhone }` (normalized; 400 `SENDER_PHONE_REQUIRED`/`INVALID_SENDER_PHONE`), offered only when the platform has `MESSAGING_PROVIDER` ≠ off (`MessagingService.offeredChannel`; public menu `restaurant.messaging`). Pickup/delivery checkout sends `notifyByMessage: true`: the phone must then be a mobile (`messagingPhoneProblem`, 400 `PHONE_NOT_MOBILE`); the order stores `notifyBy` (channel). Accepted, pickup ready, on the way, rejected and cancelled enqueue `notif:message` (job id `msg-<orderId>-<event>`, rendered Spanish text with the tracking link: never log it). Workers: `MessageSenderService` → Twilio Messages API (`whatsapp:` prefix for WhatsApp; 4xx = `UnrecoverableError`) or `mailpit` (local stacks: email to `<digits>@<channel>.mensajes.local`); idempotent through `sent_messages` (job id + provider id only). Production WhatsApp outside the 24 h session needs approved templates (pending).
- **Live floor (phase 9)**: a screen for owner and cashier with the restaurant drawn isometrically: dining room (tables colored by their account), kitchen (tickets by status with their timer), pickup counter (ready orders), delivery door (riders mini-map), indicators on top. **Each zone is drawn only when the restaurant uses it**: no active table placed on the plan → no dining room; `pickupEnabled` off → no counter; `deliveryEnabled` off → no door nor mini-map; the kitchen always. Module `modules/floor/` (its own module because it spans restaurants and the orders repositories, which `OrdersModule` exports).
  - **Model** (no migration: new fields default null): `restaurants.floorPlan` `{ cols, rows, kitchen: FloorRect, pickup: FloorRect | null, door: { x, y } | null } | null` (`FloorRect = { x, y, w, h }`, whole cells; `FLOOR_LIMITS`: cols 6–24, rows 4–16, suggested 14×9, areas ≥ 2×2, kitchen mandatory) and `tables.layout` `{ x, y, shape: "round"|"square", seats: 2|4|6|8 } | null`. A table takes 1 cell; 6–8 seats take 2×1 horizontal (`tableFootprint` in `@app/utils`). Rules in `floorPlanProblem(plan, tables)` (`@app/utils/floor-plan.ts`, shared with the editor; messages in `FLOOR_PLAN_MESSAGES`): grid within limits, areas inside the grid and apart, door on an edge and outside the areas, tables inside the grid without sharing a cell with each other, an area or the door. Inactive tables keep their layout but are never drawn (the web filters them); deleting a table deletes its layout.
  - **Routes**: `GET /api/restaurants/:id/floor-plan` (owner, cashier, kitchen, waiter) → `FloorPlanView { plan, tables: [{ id, label, active, layout }] }` (every table, placed or not). `PUT .../floor-plan` (owner) `SaveFloorPlanInput { plan | null, tables: [{ tableId, layout | null }] }` replaces the plan and **every** layout in one transaction (tables not listed come off the plan; `plan: null` deletes the plan and all layouts, ignoring `tables`); 400 `UNKNOWN_TABLE` (`meta.tableId`), 400 `INVALID_FLOOR_PLAN` (`meta.problem`); last write wins; emits `floor-plan.updated` (FloorPlanView) to `restaurant:<id>`.
  - **Kitchen goal**: `restaurants.kitchenTargetMinutes` (default 20, 5–90, `KITCHEN_TARGET_LIMITS`), owner `PATCH /api/restaurants/:id`, in `RestaurantView`.
  - **Indicators**: `GET .../live` (owner, cashier) → `LiveSummary` computed by `summarizeLive()` (`modules/orders/live-summary.ts`): today's sales (as `summarizeDay`) vs the same weekday last week up to the same **local** time (`changePercent`, whole %, null without sales then), `hourly` (local hours 0..now), `inProgress` per channel (non-final orders of any day), `kitchen` (today's average accepted→ready, or pending→ready if never accepted, whole minutes; `sample`), `tables` (positioned = active tables placed while there is a plan; occupied = open accounts with an order or a waiter call; calling, bill requested, paying in parts = open accounts with payments).
  - **Real time**: the web builds the view from `order.created`, `order.updated`, `table.updated`, `order.rider-location` (already emitted to the restaurant room by `RiderTrackingService`) and `floor-plan.updated`. Ticket timer: `OrderView.statusHistory.at(-1).at` (when the order entered its current status).
- **Receipts** are internal documents, not tax documents (no SII boleta). Accepting a pickup order enqueues `pdf:receipt` (job id `receipt-<orderId>`); the worker stores `restaurants/<id>/receipts/<orderId>.pdf` in the private bucket, emits `order.receipt-ready` and, if the customer left an email, enqueues `email:order-confirmation` (job id `order-confirmation-<orderId>`) with the PDF attached. The api serves it with 202 while pending (422 `RECEIPT_FAILED` once the job has exhausted its retries): staff `GET .../orders/:orderId/receipt`, customer `POST /api/public/orders/receipt` (token in the body).

---

## Final stack

```
Frontend    : Next.js (App Router, `output: "standalone"`)
API Core    : NestJS — REST + Socket.IO gateway (no separate BFF)
Async Jobs  : BullMQ on Valkey (Redis-compatible) — dedicated workers app
Real-time   : Socket.IO + @socket.io/redis-adapter (workers emit via @socket.io/redis-emitter)
Database    : MongoDB Community (single-node replica set) in Docker
Files       : Garage (S3-compatible object storage) — accessed with @aws-sdk/client-s3
Proxy / TLS : Caddy (automatic HTTPS with Let's Encrypt)
Secrets     : .env files on the server, versioned encrypted with SOPS + age
Email       : SMTP via nodemailer (Mailpit in dev, any SMTP provider in prod)
Deploy      : Docker Compose on a single VPS, images published to a container registry
Language    : TypeScript across all layers
```

### Containers

| Service   | Image                   | Exposed publicly        | Notes                                     |
| --------- | ----------------------- | ----------------------- | ----------------------------------------- |
| `caddy`   | `caddy:2.11.7-alpine`   | **Yes** (80, 443)       | Only container with published ports in prod |
| `web`     | built from `apps/web`   | No (via Caddy)          | Next.js standalone server on :3000, liveness at `/healthz` |
| `api`     | built from `apps/api`   | No (via Caddy)          | NestJS on :3000, global prefix `/api`     |
| `workers` | built from `apps/workers` | No                    | Consumes all BullMQ queues; internal `GET /health` on :3001 |
| `mongo`   | `mongo:8.0.32`          | No                      | Replica set `rs0`, auth enabled           |
| `valkey`  | `valkey/valkey:8.1.10-alpine` | No                | Queues, Socket.IO pub/sub, rate limiting, cache |
| `garage`  | `dxflrs/garage:v2.4.1`  | Via Caddy (`s3.` subdomain) | Only for presigned URLs               |
| `mailpit` | `axllent/mailpit:v1.31.4` | Dev only              | Catches all outgoing email locally        |

When bumping an image version, update it in `compose.yaml` **and** in the Testcontainers tests (they pin the same images).

### Toolchain — versions and known gotchas

- **Node 24** (LTS) in the images; `.nvmrc` = 24. Newer Node works for local dev.
- **TypeScript `~6.0`** — do not upgrade to 7.x yet: `@nestjs/cli` and `ts-jest` require `<7`. TS 6 requires an explicit `rootDir` when `outDir` is set.
- **NestJS 12 is ESM-only**, while our apps compile to CommonJS (Node 24 can `require()` ESM). Jest therefore runs as `node --experimental-vm-modules node_modules/jest/bin/jest.js` (same as the official Nest 12 template).
- **`@nestjs/config` 12 validates with Standard Schema** → env schemas are written in **Zod** (`src/config/env.validation.ts`); the env type is inferred from the schema.
- `ConfigModule.forRoot()` validates when `app.module` is first loaded: tests must set `process.env` **before** requiring it (see `apps/api/test/health.e2e-spec.ts`).
- **pnpm 12** blocks dependency build scripts unless listed in `allowBuilds` (`pnpm-workspace.yaml`). Decide per package with `pnpm approve-builds`; optional native add-ons are denied.
- **BullMQ 6** no longer exposes `worker.client`; health checks use their own ioredis connection.
- **Git Bash on Windows** rewrites absolute paths passed to containers (`/garage` → `C:/Program Files/Git/garage`). Shell scripts export `MSYS_NO_PATHCONV=1`. Run the `infra/scripts/*.sh` (and the pnpm scripts that call them) from Git Bash, WSL or Linux.
- ioredis `quit()` never resolves while Valkey is unreachable: shutdown code must `disconnect()` when the client is not `ready`.
- **Docker Desktop on Windows intermittently hangs/resets connections forwarded over IPv6 (`::1`)**, and `localhost` resolves to `::1` first. Everything that talks to local containers forces IPv4: Jest `setupFiles` (`ipv4-first.js`, `dns.setDefaultResultOrder("ipv4first")`), `curl -4` in `smoke.sh`, `--host-resolver-rules` in the Playwright config. Not an issue on Linux.
- **Ports 80/443 must be free** for `pnpm stack:up` (XAMPP/IIS/another Apache take them on IPv4 and answer instead of Caddy — the smoke test then fails with Apache error pages).

---

## Monorepo structure

```
/
├── apps/
│   ├── web/                  # Next.js frontend
│   ├── api/                  # NestJS — REST + WebSocket gateway
│   ├── workers/              # NestJS standalone app — BullMQ processors
│   └── print-agent/          # Windows print agent (.exe, ESC/POS)
├── packages/
│   ├── types/                # Shared types, DTOs, job payloads, WS event names
│   ├── schemas/              # Shared Mongoose schemas (created when the workers first need one)
│   └── utils/                # Pure helpers shared by api and web (slug rules); has its own unit tests
├── infra/
│   ├── caddy/Caddyfile
│   ├── docker/               # nest.Dockerfile (api + workers, ARG APP), web.Dockerfile
│   ├── mongo/                # Keyfile entrypoint, replica set healthcheck, init scripts
│   ├── garage/garage.toml
│   └── scripts/              # env-init, garage-init, smoke, deploy, backup
├── .github/workflows/ci.yml  # Tests on every push/PR; images to GHCR from main
├── compose.yaml              # Base: all services
├── compose.dev.yaml          # Dev overrides: ports on 127.0.0.1, mailpit
├── compose.prod.yaml         # Prod overrides: restart policies, log rotation, Caddy ports
├── compose.local.yaml        # Local release gate only: Mailpit for outgoing email (never on the VPS)
├── .env.example              # Every variable documented, no real values
├── .sops.yaml                # SOPS rules (age recipients) — pending, added with the first VPS deploy
├── CLAUDE.md                 # This file
└── package.json              # pnpm workspaces
```

Package manager: **pnpm workspaces**.
Always install dependencies with `pnpm add` from the root or from the corresponding workspace.

---

## General rules — always follow

- All code in **strict TypeScript** (`strict: true` in tsconfig).
- **Never** hardcode secrets, connection URLs, or API keys — always via environment variables.
- Never commit a plaintext `.env` file. Only `.env.example` and SOPS-encrypted files (`*.enc.env`) go to git.
- All endpoints must have **input validation** (class-validator in NestJS, Zod on the frontend forms).
- Explicit error handling in every layer — never an empty `catch(e) {}`.
- Structured JSON logs using **pino** (`nestjs-pino`), written to stdout — never `console.log`.
- Every module must have at least **unit tests** covering business logic.
- Every service must handle `SIGTERM` gracefully (close HTTP server, BullMQ workers and DB connections).

---

## API Core — NestJS

### Responsibilities

- Authentication: sessions in httpOnly cookies (see below)
- Business and domain logic
- CRUD operations on MongoDB via Mongoose (Repository Pattern)
- Enqueue async jobs in BullMQ
- Real-time events through the Socket.IO gateway
- Rate limiting per IP/user (`@nestjs/throttler` with Redis storage, so limits are shared across replicas)

### Authentication

Web and api share the same origin (Caddy routes `/api/*`), so the session lives in cookies the browser JS never sees.

- **Access token**: short-lived JWT (15 min) in cookie `mm_at` — `HttpOnly; Secure; SameSite=Lax; Path=/`.
- **Refresh token**: opaque random value in cookie `mm_rt` — `HttpOnly; Secure; SameSite=Strict; Path=/api/auth`. Stored **hashed** in a `sessions` collection (TTL index), **rotated on every use**; reusing an already-rotated token revokes the whole session family (theft detection). Logout and password change revoke sessions server-side.
- **Never** put tokens in `localStorage`, response bodies or URLs. (Exception: the print agent's device token is returned once by `POST /api/print-agents/pair`; see "Print agent".)
- **CSRF**: `SameSite` cookies plus an `Origin` check on every state-changing request (`POST/PUT/PATCH/DELETE`) — reject when it does not match `APP_URL`.
- **Socket.IO** authenticates from the same cookie in the handshake (same origin, no token in JS).
- **Passwords**: hashed with **argon2id** (`argon2` package). It is a native module: approve it in `allowBuilds` and verify it loads in the Alpine image.
- **Email verification**: **mandatory for owners** (cannot create or publish a restaurant until verified), **optional for customers**. Verification and invitation tokens are random, single-use, stored hashed, expire in 24 h, and are delivered through the `email` queue.
- Login, register and password-reset endpoints have stricter rate limits than the rest of the API.

### Bootstrap

```typescript
// apps/api/src/main.ts
const app = await NestFactory.create(AppModule, { bufferLogs: true });
app.useLogger(app.get(Logger)); // nestjs-pino
app.setGlobalPrefix("api");
app.useGlobalPipes(
  new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
);
app.useWebSocketAdapter(new RedisIoAdapter(app)); // Socket.IO + Redis adapter
app.enableShutdownHooks();
await app.listen(3000, "0.0.0.0");
```

### MongoDB connection

```typescript
// apps/api/src/app.module.ts
MongooseModule.forRootAsync({
  useFactory: (config: ConfigService) => ({
    uri: config.getOrThrow<string>("MONGODB_URI"),
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  }),
  inject: [ConfigService],
});
```

### NestJS module structure

```
apps/api/src/
├── modules/
│   ├── auth/
│   ├── users/
│   ├── health/                       # @nestjs/terminus — checks Mongo + Valkey
│   ├── realtime/                     # Socket.IO gateway
│   └── [domain]/
│       ├── [domain].module.ts
│       ├── [domain].controller.ts
│       ├── [domain].service.ts
│       ├── [domain].repository.ts   # abstraction over Mongoose
│       ├── dto/
│       └── schemas/
├── common/
│   ├── guards/
│   ├── interceptors/
│   ├── filters/
│   └── pipes/
└── infra/
    ├── queue/                        # BullMQ producers (QueueService)
    ├── storage/                      # S3 client pointing to Garage
    └── redis/                        # Shared Valkey connection + Socket.IO adapter
```

### NestJS rules

- Use the **Repository Pattern**: services never use Mongoose directly — they go through a Repository.
- DTOs with `class-validator` + `class-transformer` in every controller.
- Global `HttpExceptionFilter`: every error body is `{ statusCode, code, message, details? }` (`ApiErrorBody` in `@app/types`). Throw Nest exceptions with `apiError("STABLE_CODE", "Mensaje en español")`; the frontend branches on `code`, never on `message`.
- Every route requires a session by default (global `AccessTokenGuard`); opt out with `@Public()`. Global guard order: throttler → origin (CSRF) → session.
- Rate limits are shared across replicas through Valkey (`ValkeyThrottlerStorage`, in-house because `@nest-lab/throttler-storage-redis` does not declare Nest 12 support). Global default 300/min per IP; tighten sensitive routes with `@Throttle`.
- Use `ConfigModule` with a Zod validation schema — the app must fail to start if a required variable is missing.
- Global setup (prefix, pipes, logger, shutdown hooks) lives in `configureApp()` (`src/app.setup.ts`), shared by `main.ts` and the e2e tests.
- `GET /api/health` must return 200 only when Mongo and Valkey are reachable (used by Docker healthchecks).

---

## Web — Next.js

- **UI**: Tailwind CSS v4 + shadcn/ui (`components/ui/*`, added with the shadcn CLI). Theme tokens in `app/globals.css` (base stone, primary orange-700 for AA contrast with white text); change the brand by editing `--primary`, `--ring`, `--brand-soft*`. System font (no `next/font`, so builds need no font download). Light mode only for now.
- **Text in Spanish (Chile)**, routes in Spanish (`/ingresar`, `/registro`, `/verificar-email`, `/invitacion`, …) — emails from the api link to them. Mobile-first: staff use phones.
- **API access only through `lib/api.ts`** (same-origin `/api/...`): typed errors (`ApiError` with `code`), automatic single-flight refresh on 401 `UNAUTHENTICATED`, never refreshes on auth endpoints. Show the api's `message` to users; branch on `code`.
- **Sessions are checked client-side** (`AuthProvider` → `/api/auth/me`): the cookies are httpOnly and `mm_rt` is scoped to `/api/auth`, so Next middleware/proxy cannot see the session. Protected areas render a skeleton, then redirect to `/ingresar?next=…`.
- `next` redirect params go through `lib/safe-next.ts` (open-redirect protection).
- Forms: react-hook-form + zod schemas in `lib/validation.ts` that mirror the api DTOs. Forms that can be server-rendered (reachable by a full page load) take their `defaultValues` from `typedDefaults(formId, defaults)` (`lib/form-defaults.ts`) and carry `data-form="<formId>"`: react-hook-form writes `defaultValues` into the DOM when a field registers, which would erase what a slow phone's user typed before hydration. E2E tests call `waitForHydration(page)` (`<html data-hydrated>`) before typing after a navigation. Slug rules come from `@app/utils`, never re-implemented.
- No global state library; React context for auth, small hooks (`hooks/`) for data.
- Public pages (`/r`, `/m`, `/pedido`) only call `/api/auth/me` when the `mm:session` localStorage mark exists (set and cleared by `AuthProvider`), so guests never trigger 401/refresh round trips; before placing an order with a session older than 10 min the web refreshes it, so the order is linked to the account.
- PWA: `app/manifest.ts` + `public/sw.js`, which **only** handles `push` and `notificationclick` (no fetch handler, no caching) and is registered on demand when the user enables notifications (`lib/push.ts`, `hooks/use-push.ts`). One push subscription per browser is shared by the staff switch and the "Avísame" buttons: turning the switch off deletes it server-side, never `subscription.unsubscribe()`.
- Tests: **vitest** for pure logic in `lib/` (`pnpm --filter @app/web test`); **Playwright** (`pnpm test:web`) for user flows against the local prod stack (`https://localhost`, reads emails from Mailpit). Playwright is not part of CI yet.

---

## Real-time — Socket.IO

### Message flow

```
Client ──(wss://domain/socket.io)──► Caddy ──► api (Socket.IO gateway)
                                                  │  joins room `user:{userId}`
                                                  ▼
                                          Valkey pub/sub (redis-adapter)
                                                  ▲
workers ──(@socket.io/redis-emitter)──────────────┘  emits to `user:{userId}`
```

### WebSocket rules

- Same origin as the app (`/socket.io` through Caddy). `RedisIoAdapter` **rejects handshakes whose `Origin` is not `APP_URL`**: browsers send cookies on WebSocket upgrades, so this prevents cross-site WebSocket hijacking.
- **Staff** authenticate with the same httpOnly `mm_at` cookie as the REST api (read in `handleConnection`, no token in JS) and join `restaurant:<id>` via `restaurant.subscribe` — membership is checked like `RestaurantAccessGuard`. Members who are **only riders** join `rider:<restaurantId>:<userId>` instead and receive just the deliveries assigned to them (`RealtimeService.toStaffOf` emits order updates to the restaurant room plus the current and previous rider rooms), so other customers' data never reaches their browser. **Customers** are anonymous and join `order:<id>` via `order.subscribe` with their tracking token.
- Emit with `RealtimeService` (`toRestaurant(id)` / `toOrder(id)` / `toTable(tableId)`); never store socket IDs in the database. Events: `order.created`, `order.updated` (staff), `order.status` (customer, public view), `restaurant.accepting`, `qr-sheet.ready`, `order.receipt-ready` (staff and customer), `table.updated` (staff), `table.bill` (phones at the table, phase 8), `print.job-failed` (staff: a print agent job failed or expired) and `floor-plan.updated` (staff, phase 9). Print agents use their own namespace `/print-agents` (see "Print agent").
- Known limitation: a staff socket keeps its subscription until it disconnects, even if the membership is revoked meanwhile; the web reconnects on refresh, which re-checks.
- Event names and payload types live in `packages/types` — shared by api, workers and web.
- Workers never import the gateway: they emit through `@socket.io/redis-emitter` on the same Valkey.
- MongoDB Change Streams are available (replica set) — use them only when an event must react to writes made outside the api; otherwise emit explicitly from the service.

---

## Async Jobs — BullMQ

### Queues

| Job                | Queue   | Processor              |
| ------------------ | ------- | ---------------------- |
| Email sending      | `email` | `EmailProcessor`       |
| PDF generation     | `pdf`   | `PdfProcessor`         |
| Push notifications | `notif` | `NotifProcessor`       |

All processors run in the single `workers` container. Split a queue into its own container only if it needs independent scaling.

### Enqueuing a job from the api

```typescript
// apps/api/src/infra/queue/queue.service.ts
@Injectable()
export class QueueService {
  constructor(@InjectQueue("email") private readonly emailQueue: Queue<EmailJob>) {}

  async sendEmail(payload: EmailJob, idempotencyKey: string): Promise<void> {
    await this.emailQueue.add("send", payload, {
      jobId: idempotencyKey, // duplicates with the same jobId are ignored
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: { age: 24 * 3600 },
      removeOnFail: false, // failed jobs are kept for inspection (DLQ equivalent)
    });
  }
}
```

### Processor — base pattern

```typescript
// apps/workers/src/email/email.processor.ts
@Processor("email", { concurrency: 5 })
export class EmailProcessor extends WorkerHost {
  constructor(private readonly mailer: MailerService, private readonly logger: PinoLogger) {
    super();
  }

  async process(job: Job<EmailJob>): Promise<void> {
    // must be idempotent: check whether the email was already sent before sending
    await this.mailer.send(job.data);
  }
}
```

The workers app is a NestJS **standalone application** (`NestFactory.createApplicationContext`) — no HTTP server, shares modules and schemas with the api.

### Worker rules

- **Idempotency**: every processor must tolerate the same job twice. Use deterministic `jobId`s and check state before side effects.
- Every job has `attempts` + exponential `backoff`. Failed jobs stay in the `failed` set; never delete them automatically.
- Job payload types live in `packages/types`; payloads carry IDs, not whole documents. Exceptions: `email` jobs carry the rendered data (name, one-time link), because only the token hash exists in MongoDB; `pdf` jobs carry the data to print (QR URLs, the order's immutable price snapshot), so the workers need no menu or order schemas. Never log email or receipt job payloads (customer data).
- PDFs are generated with a lightweight library (`pdfkit` or `@react-pdf/renderer`) — **no headless browser** — and uploaded to Garage; the job result stores the object key.
- Graceful shutdown: on `SIGTERM`, let in-flight jobs finish (`worker.close()`), then disconnect.

---

## Valkey (Redis-compatible)

- Start with `--appendonly yes --maxmemory-policy noeviction`. **BullMQ requires `noeviction`** — any other policy can silently drop jobs.
- One Valkey instance shared by: BullMQ, Socket.IO adapter, throttler storage, cache. Use key prefixes (`bull:`, `socket.io#`, `throttle:`, `cache:`).
- Password via `--requirepass ${VALKEY_PASSWORD}`; never exposed outside the Docker network in prod.

---

## MongoDB — self-hosted replica set

### Why a replica set with a single node

- Enables **transactions** and **Change Streams**.
- Same topology locally and on the VPS.

### Setup rules

- `mongod --replSet rs0 --bind_ip_all --keyFile /etc/mongo/keyfile` — a keyfile is mandatory when auth and replica set are combined. The keyfile must be owned by the `mongodb` user with `400` permissions.
- The replica set member host must be `mongo:27017` (the compose service name), so containers can resolve it.
- Initialize with `rs.initiate()` from `infra/mongo/` on first start (idempotent script run by the healthcheck or an init container).
- From the host machine (Compass, mongosh) connect with `directConnection=true`, because `mongo` does not resolve outside Docker.
- One application user per environment with `readWrite` on its database only; the root user is used only for administration.

```
MONGODB_URI=mongodb://app_user:pass@mongo:27017/munchmate?replicaSet=rs0&authSource=munchmate
```

### Backups — our responsibility now

- `infra/scripts/backup.sh`: `mongodump --archive --gzip` from inside the container, run daily via host cron.
- Keep 7 daily + 4 weekly copies, and copy them **off the VPS** (restic or rclone to another provider).
- A backup that has never been restored does not count: test `mongorestore` on a local stack periodically.

---

## File storage — Garage (S3-compatible)

```typescript
// apps/api/src/infra/storage/storage.service.ts
const s3 = new S3Client({
  endpoint: config.getOrThrow("S3_ENDPOINT"),       // http://garage:3900 internally
  region: config.getOrThrow("S3_REGION"),           // must match s3_region in garage.toml
  forcePathStyle: true,                             // required by Garage
  credentials: {
    accessKeyId: config.getOrThrow("S3_ACCESS_KEY_ID"),
    secretAccessKey: config.getOrThrow("S3_SECRET_ACCESS_KEY"),
  },
});
```

### Storage rules

Two buckets:

| Bucket | Access | Content |
| ------ | ------ | ------- |
| `S3_BUCKET` (`munchmate`) | **Private**: only signed requests (presigned URLs via `s3.<domain>` when clients need them) | PDFs and anything not public (phase 3+) |
| `S3_MEDIA_BUCKET` (`munchmate-media`) | **Public read** through Garage's website endpoint, served at `media.<domain>` (Caddy rewrites the Host to `<bucket>.web.garage.localhost`); read-only (405 on writes) | Menu photos, logos |

- **Images are uploaded through the api, never directly to Garage**: multipart field `file`, max 8 MB (`MENU_LIMITS`), re-encoded by `infra/storage/image-processor.ts` (sharp) to WebP variants. Re-encoding strips EXIF/GPS metadata, applies orientation, validates the real bytes (the client's content type is ignored) and limits pixels (decompression bombs). Products: 4:3 `sm/md/lg` (160/480/960 px); logos: square `sm/md` (96/256 px, letterboxed).
- Use `MediaService` (`storeImage` / `deleteImage` / `productImage` / `logoImage`): it stores `<prefix>/<random id>-<variant>.webp` and the document keeps only the base key. Every upload gets a new random id, so objects are **immutable** and served with `Cache-Control: public, max-age=31536000, immutable`. Deleting old variants is best effort (logged, never fails the request).
- Key prefixes are tenant-scoped: `restaurants/<restaurantId>/products/<productId>/…`, `restaurants/<restaurantId>/logo/…`.
- Store only object keys in MongoDB, never full URLs; URLs are built with `MEDIA_PUBLIC_URL`.
- In dev, media is served at `http://munchmate-media.web.garage.localhost:3902` (browsers resolve `*.localhost`; Node may not — tests connect to 127.0.0.1 with the Host header, see `apps/api/test/support/garage.ts`).
- First-time setup (`infra/scripts/garage-init.sh`, idempotent): layout, app key, private bucket, public media bucket (website enabled).

---

## Reverse proxy — Caddy

```
# infra/caddy/Caddyfile
{$DOMAIN} {
	encode zstd gzip

	handle /api/* {
		reverse_proxy api:3000
	}
	handle /socket.io/* {
		reverse_proxy api:3000
	}
	handle {
		reverse_proxy web:3000
	}
}

s3.{$DOMAIN} {
	reverse_proxy garage:3900
}
```

- Same origin for web and api (`/api`), so no CORS and cookies work without extra configuration.
- With `DOMAIN=localhost` Caddy issues a local certificate — this is how the production stack is tested on the dev machine.
- Caddy data volume (`caddy_data`) must be persistent, or certificates will be re-requested and hit Let's Encrypt rate limits.

---

## Docker & Compose

### Image rules

- Multi-stage Dockerfiles in `infra/docker/` (one shared by the NestJS apps via `ARG APP`, one for web), base `node:24.21.0-alpine`. Dependencies come from `pnpm fetch` (cached by lockfile) and the runtime image gets `pnpm deploy --prod` output only; NestJS apps declare `"files": ["dist"]` so sources and tests are not shipped.
- Next.js uses `output: "standalone"`. **`NEXT_PUBLIC_*` variables are inlined at build time** — pass them as build args; changing them requires a rebuild.
- Containers run as a non-root user (`USER node`).
- Every service has a `healthcheck`; dependents use `depends_on: condition: service_healthy`.
- Pin exact versions for third-party images in prod (no `latest`).

### Compose files

| File                | Purpose                                                                    |
| ------------------- | -------------------------------------------------------------------------- |
| `compose.yaml`      | All services, networks, volumes, healthchecks                              |
| `compose.dev.yaml`  | Publishes mongo/valkey/garage/mailpit ports on `127.0.0.1`, adds mailpit   |
| `compose.prod.yaml` | `restart: unless-stopped`, registry image tags, log rotation, no published ports except Caddy |

### Production rules

- **Only Caddy publishes ports.** Docker-published ports bypass UFW, so publishing Mongo or Valkey exposes them to the internet even with a firewall enabled.
- Log rotation on every service: `logging: { driver: json-file, options: { max-size: "10m", max-file: "3" } }` — otherwise logs fill the disk.
- Named volumes for `mongo_data`, `valkey_data`, `garage_data`, `garage_meta`, `caddy_data`.
- Images are built in CI and pushed to a registry; the VPS only pulls. Building Next.js on a small VPS can exhaust memory.

---

## Environment variables

All variables are documented in `.env.example`. Real values live in `.env` on the server (`chmod 600`) and are versioned encrypted with SOPS + age (`.env.prod.enc.env`).

- The same `.env` serves `pnpm dev` (apps on the host) and Docker. Values that differ per context (`APP_URL`, `MONGODB_URI`, `VALKEY_URL`) are **built in `compose.yaml`** for containers; the `.env` entries are only read by the apps on the host.
- `.env` is also sourced by the shell scripts (`. ./.env`): **quote any value containing spaces, `<`, `>` or `&`**.
- Each app validates its own variables with Zod at startup (`src/config/env.validation.ts`) — that file is the source of truth.

### api

```
NODE_ENV            development | test | production
MONGODB_URI
VALKEY_URL          redis://:password@valkey:6379
APP_URL             https://<domain> (http://localhost:3100 in dev) — email links, CSRF origin, cookie Secure flag
JWT_ACCESS_SECRET   ≥ 32 chars
S3_ENDPOINT         http://garage:3900 (http://localhost:3900 in dev)
S3_REGION / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY
S3_MEDIA_BUCKET     public media bucket (munchmate-media)
MEDIA_PUBLIC_URL    https://media.<domain> (dev: http://munchmate-media.web.garage.localhost:3902)
MESSAGING_PROVIDER  off | twilio | mailpit (phase 8: whether restaurants can offer WhatsApp/SMS notices)
PRINT_AGENT_DOWNLOAD_URL  optional (phase 8): where owners download the print agent; empty = no download button
```

### workers

```
NODE_ENV
MONGODB_URI
VALKEY_URL
HEALTH_PORT         internal healthcheck port (3001)
SMTP_HOST / SMTP_PORT / SMTP_SECURE / SMTP_USER / SMTP_PASS / MAIL_FROM
S3_ENDPOINT / S3_REGION / S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY   (phase 3, PDFs)
VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY      (phase 6, web-push)
MESSAGING_PROVIDER / TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN   (phase 8; twilio requires both credentials)
```

### web

```
NEXT_PUBLIC_APP_URL   (build time)
API_INTERNAL_URL      http://api:3000   (server-side fetches from Next.js)
```

### infra

```
DOMAIN
MONGO_ROOT_USER / MONGO_ROOT_PASSWORD
VALKEY_PASSWORD
GARAGE_RPC_SECRET / GARAGE_ADMIN_TOKEN
```

---

## Development commands

```bash
# First time on a machine
pnpm install
pnpm env:init            # .env from .env.example with random secrets (refuses to overwrite)

# Daily development: infra in Docker, apps on the host with hot reload
pnpm infra:up            # compose.yaml + compose.dev.yaml: mongo, valkey, garage, mailpit
pnpm infra:init          # once per fresh volume: Garage layout, app key, bucket (idempotent)
pnpm dev                 # web (:3100), api (:3000) and workers in watch mode
pnpm infra:down          # keeps volumes; add -v manually only to wipe all data

# Single app
pnpm --filter @app/api dev
pnpm --filter @app/workers dev
pnpm --filter @app/web dev

# Print agent (apps/print-agent, see its README)
pnpm --filter @app/print-agent test          # unit tests (also part of `pnpm test`)
pnpm --filter @app/print-agent bundle        # dist/agent.cjs (needs packages built); run with `node dist/agent.cjs --help`
pnpm --filter @app/print-agent build:exe     # dist/munchmate-impresora.exe (Node SEA) — Windows only; CI job print-agent-exe

# Quality
pnpm build && pnpm typecheck
pnpm test                # unit
pnpm test:int            # integration (Testcontainers — Docker must be running)
pnpm test:e2e            # api end-to-end (Testcontainers + Supertest)
pnpm test:web            # Playwright browser flows — needs `pnpm stack:up` running (first time: pnpm --filter @app/web exec playwright install chromium)

# Production stack on the local machine (release gate) — stop the dev infra first
pnpm stack:up            # compose.yaml + compose.prod.yaml + compose.local.yaml (Mailpit), DOMAIN=localhost, builds images
pnpm stack:init          # same as infra:init, for this stack (needed only on fresh volumes)
pnpm smoke               # infra/scripts/smoke.sh against https://localhost
pnpm maps:init          # self-hosted map of Chile into Garage (Docker + ~hundreds of MB download; cached in .maps-cache/)
pnpm push:keys          # VAPID keys for web push into .env (only when empty; rotating breaks existing subscriptions)
pnpm platform:admin <email>   # grant the platform admin role to an existing account (--revoke to remove)
pnpm seed:demo           # 3 demo restaurants with full menus, photos, tables, locations and delivery zones drawn on the map (demo@munchmate.local / "munchmate demo 2026") + the rider repartidor@munchmate.local + the Pizzería's floor plan (only when it has none; the other two stay without a plan on purpose); idempotent
pnpm cert:trust          # exports Caddy's local root CA to .local-ca/caddy-root.crt and (Windows) trusts it for the current user: photos from media.localhost load, no "No es seguro"; NODE_EXTRA_CA_CERTS for Node tools
pnpm demo:reset          # sh: wipes the data volumes, keeping Caddy's CA (asks to type BORRAR; --yes skips it), then stack:up, cert:trust, stack:init, maps:init, seed:demo, platform:admin; --no-map skips the map
pnpm demo:load           # same without wiping (fills what is missing)
pnpm capturas:delivery   # screenshots of the delivery + rider tracking walkthrough into docs/capturas/delivery (needs seed:demo and maps:init; leaves demo orders)
pnpm stack:down

# Deploy (from main, after CI pushed the images)
DEPLOY_HOST=user@vps sh infra/scripts/deploy.sh <git-sha>   # checkout → pull → up --wait → smoke
```

Dev and local-prod stacks share the compose project `munch-mate`, so they share volumes (data survives switching between them) but must not run at the same time.

Mailpit UI in dev: `http://localhost:8025`.

---

## Testing

The goal: **anything that passes the release gate locally can be deployed to the VPS unchanged.**

| Level           | Tooling                                         | What it covers                                                   |
| --------------- | ----------------------------------------------- | ---------------------------------------------------------------- |
| Unit            | Jest                                            | Pure business logic (services, processors), no I/O               |
| Integration     | Jest + **Testcontainers** (mongo replica set, valkey) | Repositories, schemas, indexes, transactions, BullMQ enqueue/process |
| API E2E         | Supertest + socket.io-client on NestJS          | Endpoints, auth, validation, WebSocket auth and events           |
| Release gate    | `pnpm stack:up` + `pnpm smoke`                  | Real images, Caddy, TLS, healthchecks, inter-container networking |

### Rules

- Tests live next to the source: `user.service.spec.ts` alongside `user.service.ts`; integration as `*.int-spec.ts`, E2E in `apps/api/test/`.
- Minimum coverage on business logic (services, processors): **80%**.
- Integration tests use real Mongo and Valkey through Testcontainers — no mocks for the database or the queue (Docker must be running).
- Processors are tested twice with the same job to prove idempotency.
- The smoke test (`infra/scripts/smoke.sh`) runs against the production stack. **Each phase extends it** with the flows it introduces.
  - Phase 0 (implemented): every service healthy, HTTP→HTTPS redirect, web served, `/api/health` ok, `/api/*` routed to the api, signed S3 upload/download through `s3.<domain>`, anonymous S3 access denied, `system:ping` job round trip inside the workers container.
  - Phase 1a (implemented): protected route without session → 401, unknown login → 401, cross-origin POST → 403. **Local stack only** (`DOMAIN=localhost`, creates data): register through Caddy, `Secure`+`HttpOnly` session cookie, cookie authenticates `/me`, verification email delivered to Mailpit.
  - Phase 1b (implemented, local only): verify the email with the token read from Mailpit, create a restaurant (generated slug, owner role), invite staff and receive the invitation email, anonymous access to the restaurant → 401.
  - Phase 2 (implemented): unknown public menu → 404, media host answers and is read-only (405). Local only: create category + product, upload a photo (re-encoded, served by `media.<domain>` as `image/webp`), public menu shows the product.
  - Phase 3 (implemented): unknown table QR → 404, Socket.IO handshake through Caddy, foreign-origin handshake → 403. Local only: open the restaurant, create a table, order from its QR (server-priced total), the board lists and accepts it, customer tracking sees `accepted`, the workers generate the QR-sheet PDF.
  - Phase 6 (implemented): push configuration answers; `/api/me/orders` without session → 401.
  - Phase 7 (implemented): `/api/public/map-config` answers and map paths cannot reach other bucket keys (404).
  - Phase 8 (implemented): unknown table account → 404, anonymous floor and sales export → 401, print agent pairing with an unknown code → 400, anonymous print agents → 401. Local only: a 50 % discount prices a table order, the table account (call the waiter, ask for the bill with the tip, 409 while the kitchen has orders, split in two equal parts paid in cash and by card, the last one closing it), the day's tips apart from sales, the CSV export, and a WhatsApp notice delivered to Mailpit when a pickup order is accepted.
  - Phase 9 (implemented): anonymous floor plan and live indicators → 401.
  - MVP gaps (implemented): anonymous `/api/platform/*` → 401. Local only: the daily summary sums the orders of the run, a regular owner gets 404 on `/api/platform/*`.
  - Phase 5 (implemented): delivery zones of an unknown restaurant → 404. Local only: enable delivery, create a home zone, it is listed publicly, a delivery order adds the fee and computes the change for cash, the floor staff dispatch it, register the payment and deliver it.
  - Phase 4 (implemented): pickup order for an unknown restaurant → 404. Local only: enable pickup, order from the public menu with an email, accepting asks for a ready time, tracking shows it, the customer downloads the receipt PDF, the confirmation email with the PDF attached reaches Mailpit, the staff edit the accepted order (one more unit: total repriced, `revision` 1, receipt regenerated), the order is handed over unpaid.
  - Non-ASCII text in smoke requests must be written as JSON escapes (`\u00e1`): Git Bash on Windows passes non-ASCII arguments to curl in the console code page.
  - On the VPS the smoke test must never create users or send real emails.
- Registration is rate-limited to 5/min per IP. `pnpm smoke` registers 1 user and `pnpm test:web` 4: running both plus manual tests within the same minute hits 429 — wait a minute between heavy runs.
  - Phase 1+: login and an authenticated request through Caddy; Socket.IO authenticates and receives an event; enqueuing an email job results in a message in Mailpit (local) or a completed job (VPS).

---

## Pre-deploy checklist

- [ ] `pnpm test`, `pnpm test:int` and `pnpm test:e2e` pass
- [ ] `pnpm stack:up` + `pnpm smoke` pass locally with the exact image tag to deploy
- [ ] `.env` on the VPS matches `.env.example` (no missing variables — the api must fail fast otherwise)
- [ ] DNS for `<domain>` and `s3.<domain>` points to the VPS
- [ ] VPS firewall allows only 22, 80, 443; SSH with keys only
- [ ] Only Caddy publishes ports in `compose.prod.yaml`
- [ ] Mongo replica set initialized and app user created
- [ ] Garage layout, bucket and key created (`garage-init.sh`)
- [ ] Valkey running with `noeviction` and AOF
- [ ] Backup cron installed and a restore tested
- [ ] Log rotation configured on every service

---

## Code conventions

- **File names**: kebab-case (`user.service.ts`)
- **Class names**: PascalCase (`UserService`)
- **Variable/function names**: camelCase
- **Global constants**: SCREAMING_SNAKE_CASE
- **Git branches**: `feat/`, `fix/`, `chore/`, `infra/`
- **Commits**: Conventional Commits (`feat: add user auth`, `fix: connection pool leak`)

---

## Future scaling reference

| Component  | Action when you grow                                                          |
| ---------- | ----------------------------------------------------------------------------- |
| VPS        | Scale vertically first (more CPU/RAM) — cheapest and simplest step            |
| api        | Run 2+ replicas behind Caddy (`reverse_proxy` with multiple upstreams); Socket.IO already scales via the Redis adapter |
| workers    | Increase `concurrency`, or split a heavy queue into its own container         |
| MongoDB    | Add 2 more nodes to `rs0` (on other hosts) for high availability              |
| Garage     | Add nodes to the cluster layout for replication                               |
| Observability | Add Grafana + Loki + Prometheus when `docker logs` is no longer enough     |
| Secrets    | Move to Infisical or OpenBao when more people need access                     |
| Orchestration | Docker Swarm or k3s only when one host is no longer enough                 |
