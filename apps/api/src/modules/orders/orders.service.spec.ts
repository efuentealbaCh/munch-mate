import type { ConfigService } from "@nestjs/config";
import type { PdfQueue } from "../../infra/queue/pdf.queue";
import type { StorageService } from "../../infra/storage/storage.service";
import type { Connection } from "mongoose";
import { hashToken } from "../../common/crypto/tokens";
import type { ApiEnv } from "../../config/env.validation";
import type { CategoriesRepository } from "../menu/categories.repository";
import type { ModifierGroupsRepository } from "../menu/modifier-groups.repository";
import type { ProductsRepository } from "../menu/products.repository";
import type { RealtimeService } from "../realtime/realtime.service";
import type { TenantContext } from "../restaurants/restaurant-access.guard";
import type { RestaurantsRepository } from "../restaurants/restaurants.repository";
import type { UsersRepository } from "../users/users.repository";
import type { CountersRepository } from "./counters.repository";
import { deriveAccessToken } from "./order-tokens";
import type { OrderRecord, OrdersRepository } from "./orders.repository";
import { OrdersService } from "./orders.service";
import type { TablesRepository } from "./tables.repository";

const SECRET = "s".repeat(64);
const restaurant = {
  id: "r1",
  name: "Don Pepe",
  slug: "don-pepe",
  description: "",
  phone: "",
  logoKey: null,
  acceptingOrders: true,
  pickupEnabled: true,
  currency: "CLP",
  timezone: "America/Santiago",
  status: "active" as const,
  createdBy: "u1",
};
const table = { id: "t1", restaurantId: "r1", label: "Mesa 4", token: "abc", active: true };
const tenant: TenantContext = { restaurantId: "r1", roles: ["kitchen"], status: "active" };

function order(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: "o1",
    restaurantId: "r1",
    number: 7,
    ticketNumber: 3,
    businessDate: "2026-10-07",
    channel: "dine_in",
    status: "pending",
    statusHistory: [{ status: "pending", at: new Date(), byUserId: null, byName: null, reason: null }],
    paymentStatus: "unpaid",
    paymentMethod: null,
    items: [],
    subtotal: 1000,
    total: 1000,
    currency: "CLP",
    customerName: "",
    customerPhone: "",
    customerEmail: "",
    note: "",
    tableId: "t1",
    tableLabel: "Mesa 4",
    estimatedReadyAt: null,
    clientOrderId: "c-1",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function setup(
  options: {
    accepting?: boolean;
    pickupEnabled?: boolean;
    existing?: OrderRecord | null;
    current?: OrderRecord | null;
    activeByPhone?: number;
    receipt?: Buffer | null;
  } = {},
) {
  const emitted: string[] = [];
  const pdfQueue = {
    enqueueReceipt: jest.fn(async () => undefined),
    receiptFailed: jest.fn(async () => false),
  };
  const storage = { getPrivate: jest.fn(async () => options.receipt ?? null) };
  const restaurantRecord = () => ({
    ...restaurant,
    acceptingOrders: options.accepting ?? true,
    pickupEnabled: options.pickupEnabled ?? true,
  });
  const orders = {
    findByClientOrderId: jest.fn(async () => options.existing ?? null),
    create: jest.fn(async () => order()),
    findOne: jest.fn(async () => (options.current === undefined ? order() : options.current)),
    findByAccessTokenHash: jest.fn(async () => (options.current === undefined ? order() : options.current)),
    transition: jest.fn(
      async (_r: string, _o: string, _from: string, change: { to: string; estimatedReadyAt?: Date }) => {
        const current = options.current ?? order();
        return order({
          ...current,
          status: change.to as OrderRecord["status"],
          estimatedReadyAt: change.estimatedReadyAt ?? null,
          statusHistory: [
            ...current.statusHistory,
            { status: change.to as OrderRecord["status"], at: new Date(), byUserId: "u1", byName: "Ana", reason: null },
          ],
        });
      },
    ),
    countActiveByPhone: jest.fn(async () => options.activeByPhone ?? 0),
    listActive: jest.fn(async () => [order()]),
    listByBusinessDate: jest.fn(async () => []),
    markPaid: jest.fn(async () => order({ paymentStatus: "paid", paymentMethod: "cash" })),
  };
  const service = new OrdersService(
    orders as unknown as OrdersRepository,
    { next: jest.fn(async () => 1) } as unknown as CountersRepository,
    { findByToken: jest.fn(async () => table) } as unknown as TablesRepository,
    {
      findById: jest.fn(async () => restaurantRecord()),
      findBySlug: jest.fn(async (slug: string) => (slug === "don-pepe" ? restaurantRecord() : null)),
    } as unknown as RestaurantsRepository,
    { list: jest.fn(async () => [{ id: "c1", name: "C", description: "", active: true, position: 0 }]) } as unknown as CategoriesRepository,
    {
      list: jest.fn(async () => [
        { id: "p1", categoryId: "c1", name: "Completo", description: "", price: 1000, available: true, visible: true, imageKey: null, modifierGroupIds: [], position: 0 },
      ]),
    } as unknown as ProductsRepository,
    { list: jest.fn(async () => []) } as unknown as ModifierGroupsRepository,
    { findById: jest.fn(async () => ({ id: "u1", name: "Ana" })) } as unknown as UsersRepository,
    {
      toRestaurant: () => ({ emit: (event: string) => emitted.push(`restaurant:${event}`) }),
      toOrder: () => ({ emit: (event: string) => emitted.push(`order:${event}`) }),
    } as unknown as RealtimeService,
    pdfQueue as unknown as PdfQueue,
    storage as unknown as StorageService,
    { transaction: (fn: (s: unknown) => Promise<unknown>) => fn({}) } as unknown as Connection,
    {
      get: (key: string) => (key === "APP_URL" ? "https://munch.test" : SECRET),
    } as unknown as ConfigService<ApiEnv, true>,
  );
  return { service, orders, emitted, pdfQueue, storage };
}

const input = { clientOrderId: "c-1", items: [{ productId: "p1", quantity: 1, modifiers: [] }] };

describe("OrdersService.createDineIn", () => {
  it("creates the order, stores only the token hash and notifies the staff", async () => {
    const { service, orders, emitted } = setup();

    const result = await service.createDineIn("abc", input);

    const token = deriveAccessToken(SECRET, "r1", "c-1");
    expect(result.accessToken).toBe(token);
    expect(orders.create).toHaveBeenCalledWith(
      "r1",
      expect.objectContaining({ accessTokenHash: hashToken(token), total: 1000, tableLabel: "Mesa 4" }),
      {},
    );
    expect(emitted).toEqual(["restaurant:order.created"]);
  });

  it("returns the existing order for a retried clientOrderId, even if the restaurant closed meanwhile", async () => {
    const { service, orders } = setup({ existing: order(), accepting: false });

    const result = await service.createDineIn("abc", input);

    expect(result.order.number).toBe(7);
    expect(orders.create).not.toHaveBeenCalled();
  });

  it("refuses orders while closed", async () => {
    await expect(setup({ accepting: false }).service.createDineIn("abc", input)).rejects.toMatchObject({
      response: { code: "NOT_ACCEPTING_ORDERS" },
    });
  });

  it("resolves a duplicate-key race by returning the order that won", async () => {
    const { service, orders } = setup();
    orders.create.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: 11000 }));
    orders.findByClientOrderId.mockResolvedValueOnce(null).mockResolvedValueOnce(order({ number: 9 }));

    await expect(service.createDineIn("abc", input)).resolves.toMatchObject({ order: { number: 9 } });
  });
});

describe("OrdersService.changeStatus", () => {
  it.each([
    ["invalid transition", "ready", undefined, "INVALID_TRANSITION"],
    ["missing reason", "rejected", undefined, "REASON_REQUIRED"],
  ])("rejects a %s", async (_, to, reason, code) => {
    await expect(setup().service.changeStatus(tenant, "u1", "o1", to as "ready", reason)).rejects.toMatchObject({
      response: { code },
    });
  });

  it("forbids roles the state machine does not allow", async () => {
    await expect(
      setup().service.changeStatus({ ...tenant, roles: ["rider"] }, "u1", "o1", "accepted"),
    ).rejects.toMatchObject({ response: { code: "FORBIDDEN_ROLE" } });
  });

  it("reports a concurrent change instead of overwriting it", async () => {
    const { service, orders } = setup();
    orders.transition.mockResolvedValueOnce(null as never);

    await expect(service.changeStatus(tenant, "u1", "o1", "accepted")).rejects.toMatchObject({
      response: { code: "ORDER_CHANGED" },
    });
  });

  it("records the staff name and notifies both the board and the customer", async () => {
    const { service, orders, emitted } = setup();

    await service.changeStatus(tenant, "u1", "o1", "accepted");

    expect(orders.transition).toHaveBeenCalledWith("r1", "o1", "pending", {
      to: "accepted",
      byUserId: "u1",
      byName: "Ana",
      reason: null,
    });
    expect(emitted).toEqual(["restaurant:order.updated", "order:order.status"]);
  });
});

describe("OrdersService customer actions", () => {
  it("cannot cancel once accepted", async () => {
    await expect(setup({ current: order({ status: "accepted" }) }).service.cancelByCustomer("tok")).rejects.toMatchObject({
      response: { code: "ORDER_NOT_CANCELLABLE" },
    });
  });

  it("unknown tokens are not found", async () => {
    await expect(setup({ current: null }).service.findForCustomer("tok")).rejects.toMatchObject({
      response: { code: "ORDER_NOT_FOUND" },
    });
  });

  it("marks payments and notifies the board", async () => {
    const { service, emitted } = setup();

    await expect(service.markPaid(tenant, "o1", "cash")).resolves.toMatchObject({ paymentStatus: "paid" });
    expect(emitted).toEqual(["restaurant:order.updated"]);
  });
});

const pickupInput = {
  ...input,
  customerName: " Ana Pérez ",
  customerPhone: "9 1234 5678",
  customerEmail: "Ana@Example.com",
};
const pickupOrder = (overrides: Partial<OrderRecord> = {}) =>
  order({
    channel: "pickup",
    tableId: null,
    tableLabel: null,
    customerName: "Ana Pérez",
    customerPhone: "+56912345678",
    customerEmail: "ana@example.com",
    ...overrides,
  });

describe("OrdersService.createPickup", () => {
  it("normalizes the customer's contact data and creates a pickup order without a table", async () => {
    const { service, orders, emitted } = setup();

    await service.createPickup("Don-Pepe", pickupInput);

    expect(orders.countActiveByPhone).toHaveBeenCalledWith("r1", "+56912345678");
    expect(orders.create).toHaveBeenCalledWith(
      "r1",
      expect.objectContaining({
        channel: "pickup",
        customerName: "Ana Pérez",
        customerPhone: "+56912345678",
        customerEmail: "ana@example.com",
        tableId: null,
        tableLabel: null,
      }),
      {},
    );
    expect(emitted).toEqual(["restaurant:order.created"]);
  });

  it.each([
    ["an unknown restaurant", { slug: "otro" }, "MENU_NOT_FOUND"],
    ["an invalid phone", { phone: "12" }, "INVALID_PHONE"],
    ["a closed restaurant", { accepting: false }, "NOT_ACCEPTING_ORDERS"],
    ["pickup disabled by the owner", { pickupEnabled: false }, "PICKUP_DISABLED"],
    ["too many orders in progress for that phone", { activeByPhone: 3 }, "TOO_MANY_ACTIVE_ORDERS"],
  ])("refuses %s", async (_, cfg: { slug?: string; phone?: string; accepting?: boolean; pickupEnabled?: boolean; activeByPhone?: number }, code) => {
    const { service } = setup(cfg);
    await expect(
      service.createPickup(cfg.slug ?? "don-pepe", { ...pickupInput, customerPhone: cfg.phone ?? pickupInput.customerPhone }),
    ).rejects.toMatchObject({ response: { code } });
  });

  it("answers 429 when the per-phone limit is reached", async () => {
    await expect(setup({ activeByPhone: 3 }).service.createPickup("don-pepe", pickupInput)).rejects.toMatchObject({
      status: 429,
    });
  });

  it("returns a retried submission even if the phone limit was reached meanwhile", async () => {
    const { service, orders } = setup({ existing: pickupOrder(), activeByPhone: 3 });

    await expect(service.createPickup("don-pepe", pickupInput)).resolves.toMatchObject({ order: { channel: "pickup" } });
    expect(orders.create).not.toHaveBeenCalled();
  });
});

describe("OrdersService pickup acceptance and receipts", () => {
  it("asks for a ready time when accepting a pickup order", async () => {
    await expect(
      setup({ current: pickupOrder() }).service.changeStatus(tenant, "u1", "o1", "accepted"),
    ).rejects.toMatchObject({ response: { code: "READY_TIME_REQUIRED" } });
  });

  it("stores the ready time and requests the receipt with the tracking link for the email", async () => {
    const { service, orders, pdfQueue } = setup({ current: pickupOrder() });
    const before = Date.now();

    const view = await service.changeStatus(tenant, "u1", "o1", "accepted", undefined, 15);

    const change = orders.transition.mock.calls[0]![3];
    expect(change.estimatedReadyAt!.getTime()).toBeGreaterThanOrEqual(before + 15 * 60_000);
    expect(view.receiptAvailable).toBe(true);
    const token = deriveAccessToken(SECRET, "r1", "c-1");
    expect(pdfQueue.enqueueReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "o1",
        outputKey: "restaurants/r1/receipts/o1.pdf",
        receipt: expect.objectContaining({ customerPhone: "+56912345678", timezone: "America/Santiago" }),
        email: { to: "ana@example.com", trackingUrl: `https://munch.test/pedido#t=${token}` },
      }),
    );
  });

  it("generates the receipt without email when the customer left none", async () => {
    const { service, pdfQueue } = setup({ current: pickupOrder({ customerEmail: "" }) });

    await service.changeStatus(tenant, "u1", "o1", "accepted", undefined, 10);

    expect(pdfQueue.enqueueReceipt).toHaveBeenCalledWith(expect.objectContaining({ email: null }));
  });

  it("never requests receipts for dine-in orders", async () => {
    const { service, pdfQueue } = setup();

    await service.changeStatus(tenant, "u1", "o1", "accepted");

    expect(pdfQueue.enqueueReceipt).not.toHaveBeenCalled();
  });

  it("serves the receipt once the workers stored it, pending before that", async () => {
    const accepted = pickupOrder({
      status: "accepted",
      statusHistory: [
        { status: "pending", at: new Date(), byUserId: null, byName: null, reason: null },
        { status: "accepted", at: new Date(), byUserId: "u1", byName: "Ana", reason: null },
      ],
    });

    await expect(setup({ current: accepted }).service.getReceiptForCustomer("tok")).resolves.toEqual({
      status: "pending",
    });
    const pdf = Buffer.from("%PDF");
    const { service, storage } = setup({ current: accepted, receipt: pdf });
    await expect(service.getReceipt(tenant, "o1")).resolves.toEqual({
      status: "ready",
      pdf,
      filename: "comprobante-pedido-7.pdf",
    });
    expect(storage.getPrivate).toHaveBeenCalledWith("restaurants/r1/receipts/o1.pdf");
  });

  it("reports a receipt the workers could not generate instead of waiting forever", async () => {
    const accepted = pickupOrder({
      status: "accepted",
      statusHistory: [
        { status: "pending", at: new Date(), byUserId: null, byName: null, reason: null },
        { status: "accepted", at: new Date(), byUserId: "u1", byName: "Ana", reason: null },
      ],
    });
    const { service, pdfQueue } = setup({ current: accepted });
    pdfQueue.receiptFailed.mockResolvedValueOnce(true);

    await expect(service.getReceiptForCustomer("tok")).rejects.toMatchObject({ response: { code: "RECEIPT_FAILED" } });
    expect(pdfQueue.receiptFailed).toHaveBeenCalledWith("o1");
  });

  it("has no receipt before acceptance or for dine-in orders", async () => {
    await expect(setup({ current: pickupOrder() }).service.getReceiptForCustomer("tok")).rejects.toMatchObject({
      response: { code: "RECEIPT_NOT_FOUND" },
    });
    await expect(setup().service.getReceipt(tenant, "o1")).rejects.toMatchObject({
      response: { code: "RECEIPT_NOT_FOUND" },
    });
  });
});
