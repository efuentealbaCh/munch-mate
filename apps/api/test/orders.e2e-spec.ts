import { randomUUID } from "node:crypto";
import type {
  ClientToServerEvents,
  CreatedOrder,
  ModifierGroupView,
  OrderView,
  ProductView,
  PublicOrderView,
  ServerToClientEvents,
  TableView,
} from "@app/types";
import { io, type Socket } from "socket.io-client";
import request from "supertest";
import type TestAgent from "supertest/lib/agent";
import { fixtures } from "./support/fixtures";
import { createTestApp, resetRateLimits, TEST_APP_URL, type TestContext } from "./support/test-app";

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

describe("Dine-in orders (e2e)", () => {
  let ctx: TestContext;
  let f: ReturnType<typeof fixtures>;
  const sockets: ClientSocket[] = [];

  beforeAll(async () => {
    ctx = await createTestApp({ listen: true });
    f = fixtures(ctx);
  });

  beforeEach(async () => {
    await resetRateLimits(ctx.valkeyUrl);
  });

  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.disconnect();
  });

  afterAll(async () => {
    await ctx?.close();
  });

  /** Owner + open restaurant + menu (one product with a required size, one sold out) + one table. */
  async function setup() {
    const { owner, restaurant } = await f.ownerWithRestaurant("Completos Don Pepe");
    const base = `/api/restaurants/${restaurant.id}`;
    const post = async <T>(agent: TestAgent, path: string, body: object) =>
      (await agent.post(`${base}${path}`).send(body).expect(201)).body as T;

    const category = await post<{ id: string }>(owner.agent, "/menu/categories", { name: "Completos" });
    const size = await post<ModifierGroupView>(owner.agent, "/menu/modifier-groups", {
      name: "Tamaño",
      minSelect: 1,
      maxSelect: 1,
      options: [
        { name: "Normal", priceDelta: 0 },
        { name: "XL", priceDelta: 1500 },
      ],
    });
    const completo = await post<ProductView>(owner.agent, "/menu/products", {
      categoryId: category.id,
      name: "Completo italiano",
      price: 3490,
      modifierGroupIds: [size.id],
    });
    const soldOut = await post<ProductView>(owner.agent, "/menu/products", {
      categoryId: category.id,
      name: "As italiano",
      price: 5490,
    });
    await owner.agent.patch(`${base}/menu/products/${soldOut.id}/availability`).send({ available: false }).expect(204);
    const table = await post<TableView>(owner.agent, "/tables", { label: "Mesa 4" });
    await owner.agent.put(`${base}/accepting-orders`).send({ acceptingOrders: true }).expect(200);

    const xl = size.options[1]!.id;
    const cart = (quantity = 2) => ({
      clientOrderId: randomUUID(),
      customerName: "Camila",
      items: [{ productId: completo.id, quantity, modifiers: [{ groupId: size.id, optionIds: [xl] }] }],
    });
    const order = async (body: object = cart()) =>
      (await request(f.server).post(`/api/public/tables/${table.token}/orders`).send(body).expect(201))
        .body as CreatedOrder;

    return { owner, restaurant, base, completo, soldOut, size, table, cart, order };
  }

  /** Connects a Socket.IO client like a browser on the app's origin, optionally with a session cookie. */
  async function connect(cookie?: string): Promise<ClientSocket> {
    const socket: ClientSocket = io(ctx.baseUrl, {
      transports: ["websocket"],
      extraHeaders: { origin: TEST_APP_URL, ...(cookie ? { cookie } : {}) },
      forceNew: true,
    });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("connect_error", reject);
    });
    return socket;
  }

  /** Logs in with a fresh agent and returns the `mm_at` cookie for Socket.IO. */
  async function sessionCookie(agent: TestAgent): Promise<string> {
    const me = await agent.get("/api/auth/me").expect(200);
    const res = await request(f.server)
      .post("/api/auth/login")
      .send({ email: me.body.email, password: "correct horse battery" })
      .expect(200);
    const header = (res.headers["set-cookie"] as unknown as string[]).find((c) => c.startsWith("mm_at="))!;
    return header.split(";")[0]!;
  }

  const nextEvent = <E extends keyof ServerToClientEvents>(socket: ClientSocket, event: E) =>
    new Promise<Parameters<ServerToClientEvents[E]>[0]>((resolve) => {
      socket.once(event as "order.created", ((payload: unknown) => resolve(payload as never)) as never);
    });

  describe("placing an order from a table QR", () => {
    it("shows the table context and prices the order on the server", async () => {
      const s = await setup();

      const context = await request(f.server).get(`/api/public/tables/${s.table.token}`).expect(200);
      expect(context.body).toEqual({
        tableLabel: "Mesa 4",
        restaurant: { name: "Completos Don Pepe", slug: s.restaurant.slug },
        acceptingOrders: true,
      });

      const { accessToken, order } = await s.order();

      expect(accessToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(order).toMatchObject({
        status: "pending",
        number: 1,
        ticketNumber: 1,
        tableLabel: "Mesa 4",
        total: (3490 + 1500) * 2,
        currency: "CLP",
        cancellable: true,
      });
      expect(order.items[0]).toMatchObject({
        name: "Completo italiano",
        unitPrice: 3490,
        quantity: 2,
        modifiers: [{ groupName: "Tamaño", optionName: "XL", priceDelta: 1500 }],
      });
      expect((await s.order()).order).toMatchObject({ number: 2, ticketNumber: 2 });
    });

    it("never accepts prices from the client", async () => {
      const s = await setup();
      const body = s.cart();
      (body.items[0] as Record<string, unknown>).price = 1;

      const res = await request(f.server).post(`/api/public/tables/${s.table.token}/orders`).send(body).expect(400);

      expect(res.body.code).toBe("VALIDATION_FAILED");
    });

    it("is idempotent per clientOrderId: a retried submission returns the same order and token", async () => {
      const s = await setup();
      const body = s.cart();

      const first = await s.order(body);
      const retry = await s.order(body);

      expect(retry.accessToken).toBe(first.accessToken);
      expect(retry.order.number).toBe(first.order.number);
      const list = (await s.owner.agent.get(`${s.base}/orders`).expect(200)).body as OrderView[];
      expect(list).toHaveLength(1);
    });

    it("rejects carts that do not match the menu", async () => {
      const s = await setup();
      const other = await setup();
      const submit = (items: object[]) =>
        request(f.server)
          .post(`/api/public/tables/${s.table.token}/orders`)
          .send({ clientOrderId: randomUUID(), items });

      const missingSize = await submit([{ productId: s.completo.id, quantity: 1, modifiers: [] }]).expect(409);
      expect(missingSize.body).toMatchObject({ code: "INVALID_MODIFIERS", meta: { productId: s.completo.id } });

      const soldOut = await submit([{ productId: s.soldOut.id, quantity: 1, modifiers: [] }]).expect(409);
      expect(soldOut.body.code).toBe("PRODUCT_SOLD_OUT");

      // A product of another restaurant is "not on this menu", whatever its id.
      const foreign = await submit([{ productId: other.completo.id, quantity: 1, modifiers: [] }]).expect(409);
      expect(foreign.body.code).toBe("PRODUCT_NOT_AVAILABLE");
    });

    it("refuses orders while the restaurant is closed, and from inactive or unknown tables", async () => {
      const s = await setup();
      await s.owner.agent.put(`${s.base}/accepting-orders`).send({ acceptingOrders: false }).expect(200);

      const closed = await request(f.server)
        .post(`/api/public/tables/${s.table.token}/orders`)
        .send(s.cart())
        .expect(409);
      expect(closed.body.code).toBe("NOT_ACCEPTING_ORDERS");

      await s.owner.agent.patch(`${s.base}/tables/${s.table.id}`).send({ active: false }).expect(200);
      await request(f.server).get(`/api/public/tables/${s.table.token}`).expect(404);
      await request(f.server).get("/api/public/tables/nonexistent").expect(404);
    });

    it("regenerating a table code invalidates the old QR", async () => {
      const s = await setup();

      const regenerated = (await s.owner.agent.post(`${s.base}/tables/${s.table.id}/regenerate-token`).expect(201))
        .body as TableView;

      expect(regenerated.token).not.toBe(s.table.token);
      await request(f.server).get(`/api/public/tables/${s.table.token}`).expect(404);
      await request(f.server).get(`/api/public/tables/${regenerated.token}`).expect(200);
    });
  });

  describe("the kitchen and the cashier", () => {
    it("moves the order through the state machine and records who did it", async () => {
      const s = await setup();
      const cook = await f.staff(s.owner.agent, s.restaurant.id, ["kitchen"]);
      const { order } = await s.order();
      const [listed] = (await cook.agent.get(`${s.base}/orders`).expect(200)).body as OrderView[];
      const path = `${s.base}/orders/${listed!.id}/status`;

      expect(listed).toMatchObject({ number: order.number, status: "pending", customerName: "Camila" });

      const skip = await cook.agent.post(path).send({ status: "ready" }).expect(409);
      expect(skip.body.code).toBe("INVALID_TRANSITION");

      for (const status of ["accepted", "preparing", "ready", "served"]) {
        await cook.agent.post(path).send({ status }).expect(200);
      }
      const done = (await cook.agent.get(`${s.base}/orders/${listed!.id}`).expect(200)).body as OrderView;
      expect(done.statusHistory.map((h) => h.status)).toEqual(["pending", "accepted", "preparing", "ready", "served"]);
      expect(done.statusHistory[1]?.byName).toBe("Ana");

      // Finished orders leave the board but stay in today's list.
      expect((await cook.agent.get(`${s.base}/orders`)).body).toEqual([]);
      expect((await cook.agent.get(`${s.base}/orders`).query({ scope: "today" })).body).toHaveLength(1);
    });

    it("requires a reason to reject, and shows it to the customer", async () => {
      const s = await setup();
      const { accessToken } = await s.order();
      const [listed] = (await s.owner.agent.get(`${s.base}/orders`)).body as OrderView[];
      const path = `${s.base}/orders/${listed!.id}/status`;

      const noReason = await s.owner.agent.post(path).send({ status: "rejected" }).expect(400);
      expect(noReason.body.code).toBe("REASON_REQUIRED");
      await s.owner.agent.post(path).send({ status: "rejected", reason: "Se nos acabó el pan" }).expect(200);

      const tracked = (await request(f.server).post("/api/public/orders/lookup").send({ accessToken }).expect(200))
        .body as PublicOrderView;
      expect(tracked).toMatchObject({ status: "rejected", rejectReason: "Se nos acabó el pan", cancellable: false });
      expect(JSON.stringify(tracked)).not.toMatch(/byName|Ana/);
    });

    it("only the cashier or the owner registers payments", async () => {
      const s = await setup();
      const cook = await f.staff(s.owner.agent, s.restaurant.id, ["kitchen"]);
      const cashier = await f.staff(s.owner.agent, s.restaurant.id, ["cashier"]);
      await s.order();
      const [listed] = (await s.owner.agent.get(`${s.base}/orders`)).body as OrderView[];
      const path = `${s.base}/orders/${listed!.id}/payment`;

      await cook.agent.post(path).send({ method: "cash" }).expect(403);
      const paid = (await cashier.agent.post(path).send({ method: "card_pos" }).expect(200)).body as OrderView;

      expect(paid).toMatchObject({ paymentStatus: "paid", paymentMethod: "card_pos", status: "pending" });
    });

    it("keeps orders isolated between restaurants", async () => {
      const mine = await setup();
      const other = await setup();
      await mine.order();
      const [listed] = (await mine.owner.agent.get(`${mine.base}/orders`)).body as OrderView[];

      await other.owner.agent.get(`${mine.base}/orders`).expect(404);
      // Another tenant's order id through one's own restaurant path: not found, not accessible.
      await other.owner.agent.get(`${other.base}/orders/${listed!.id}`).expect(404);
      await other.owner.agent.post(`${other.base}/orders/${listed!.id}/status`).send({ status: "accepted" }).expect(404);
    });
  });

  describe("the customer", () => {
    it("tracks the order with the token and can cancel only while pending", async () => {
      const s = await setup();
      const first = await s.order();
      const second = await s.order();

      const cancelled = await request(f.server)
        .post("/api/public/orders/cancel")
        .send({ accessToken: first.accessToken })
        .expect(200);
      expect(cancelled.body.status).toBe("cancelled");

      const list = (await s.owner.agent.get(`${s.base}/orders`)).body as OrderView[];
      await s.owner.agent.post(`${s.base}/orders/${list[0]!.id}/status`).send({ status: "accepted" }).expect(200);
      const late = await request(f.server)
        .post("/api/public/orders/cancel")
        .send({ accessToken: second.accessToken })
        .expect(409);
      expect(late.body.code).toBe("ORDER_NOT_CANCELLABLE");

      await request(f.server)
        .post("/api/public/orders/lookup")
        .send({ accessToken: "x".repeat(43) })
        .expect(404);
    });
  });

  describe("real time (Socket.IO)", () => {
    it("pushes new orders to the staff and status changes to the customer", async () => {
      const s = await setup();
      const staff = await connect(await sessionCookie(s.owner.agent));
      expect(await staff.emitWithAck("restaurant.subscribe", s.restaurant.id)).toEqual({ ok: true });

      const created = nextEvent(staff, "order.created");
      const { accessToken } = await s.order();
      const pushed = await created;
      expect(pushed).toMatchObject({ status: "pending", customerName: "Camila", tableLabel: "Mesa 4" });

      const customer = await connect();
      expect(await customer.emitWithAck("order.subscribe", accessToken)).toEqual({ ok: true });
      const statusEvent = nextEvent(customer, "order.status");
      await s.owner.agent.post(`${s.base}/orders/${pushed.id}/status`).send({ status: "accepted" }).expect(200);

      expect(await statusEvent).toMatchObject({ status: "accepted", cancellable: false });
    });

    it("refuses subscriptions to restaurants the user does not belong to, and anonymous ones", async () => {
      const s = await setup();
      const outsider = await f.user();

      const intruder = await connect(await sessionCookie(outsider.agent));
      expect(await intruder.emitWithAck("restaurant.subscribe", s.restaurant.id)).toEqual({
        ok: false,
        code: "RESTAURANT_NOT_FOUND",
      });

      const anonymous = await connect();
      expect(await anonymous.emitWithAck("restaurant.subscribe", s.restaurant.id)).toEqual({
        ok: false,
        code: "UNAUTHENTICATED",
      });
      expect(await anonymous.emitWithAck("order.subscribe", "x".repeat(43))).toEqual({
        ok: false,
        code: "ORDER_NOT_FOUND",
      });
    });

    it("rejects WebSocket handshakes from foreign origins (cross-site WebSocket hijacking)", async () => {
      const socket: ClientSocket = io(ctx.baseUrl, {
        transports: ["websocket"],
        extraHeaders: { origin: "https://evil.example" },
        forceNew: true,
        reconnection: false,
      });
      sockets.push(socket);

      await expect(
        new Promise<void>((resolve, reject) => {
          socket.once("connect", () => resolve());
          socket.once("connect_error", reject);
        }),
      ).rejects.toBeDefined();
    });
  });

  describe("QR sheet", () => {
    it("enqueues the PDF and keeps each restaurant's jobs private", async () => {
      const s = await setup();
      const other = await setup();

      const { jobId } = (await s.owner.agent.post(`${s.base}/tables/qr-sheet`).expect(202)).body as { jobId: string };
      // No workers run in these tests: the job stays pending (the PDF itself is covered by the workers tests).
      expect((await s.owner.agent.get(`${s.base}/tables/qr-sheet/${jobId}`).expect(202)).body).toEqual({
        status: "pending",
      });

      const foreign = await other.owner.agent.get(`${other.base}/tables/qr-sheet/${jobId}`).expect(404);
      expect(foreign.body.code).toBe("QR_SHEET_NOT_FOUND");
    });
  });
});
