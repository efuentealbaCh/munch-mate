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
│   └── workers/              # NestJS standalone app — BullMQ processors
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
- **Never** put tokens in `localStorage`, response bodies or URLs.
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
- Forms: react-hook-form + zod schemas in `lib/validation.ts` that mirror the api DTOs. Slug rules come from `@app/utils`, never re-implemented.
- No global state library; React context for auth, small hooks (`hooks/`) for data.
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
- Emit with `RealtimeService` (`toRestaurant(id)` / `toOrder(id)`); never store socket IDs in the database. Events: `order.created`, `order.updated` (staff), `order.status` (customer, public view), `restaurant.accepting`, `qr-sheet.ready`, `order.receipt-ready` (staff and customer).
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
pnpm platform:admin <email>   # grant the platform admin role to an existing account (--revoke to remove)
pnpm seed:demo           # 3 demo restaurants with full menus and photos (demo@munchmate.local / "munchmate demo 2026"); idempotent
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
  - MVP gaps (implemented): anonymous `/api/platform/*` → 401. Local only: the daily summary sums the orders of the run, a regular owner gets 404 on `/api/platform/*`.
  - Phase 5 (implemented): delivery zones of an unknown restaurant → 404. Local only: enable delivery, create a home zone, it is listed publicly, a delivery order adds the fee and computes the change for cash, the floor staff dispatch it, register the payment and deliver it.
  - Phase 4 (implemented): pickup order for an unknown restaurant → 404. Local only: enable pickup, order from the public menu with an email, accepting asks for a ready time, tracking shows it, the customer downloads the receipt PDF, the confirmation email with the PDF attached reaches Mailpit, the order is handed over unpaid.
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
