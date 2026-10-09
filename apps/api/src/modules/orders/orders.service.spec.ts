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
import type { MembershipsRepository } from "../restaurants/memberships.repository";
import type { RestaurantsRepository } from "../restaurants/restaurants.repository";
import type { UsersRepository } from "../users/users.repository";
import type { CountersRepository } from "./counters.repository";
import type { DeliveryZonesRepository } from "./delivery-zones.repository";
import { deriveAccessToken } from "./order-tokens";
import type { OrderRecord, OrdersRepository } from "./orders.repository";
import { OrdersService } from "./orders.service";
import type { MapsService } from "../maps/maps.service";
import type { RiderTrackingService } from "./rider-tracking.service";
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
  deliveryEnabled: true,
  maxItemsPerOrder: 10,
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
    deliveryFee: 0,
    total: 1000,
    currency: "CLP",
    customerName: "",
    customerPhone: "",
    customerEmail: "",
    note: "",
    tableId: "t1",
    tableLabel: "Mesa 4",
    estimatedReadyAt: null,
    delivery: null,
    expectedPayment: null,
    riderId: null,
    riderName: null,
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
    deliveryEnabled?: boolean;
    zone?: { id: string; name: string; fee: number; minOrder: number; active: boolean; area?: unknown } | null;
    membershipRoles?: string[] | null;
    insideZone?: boolean;
    mapAvailable?: boolean;
  } = {},
) {
  const emitted: string[] = [];
  const tracking = { clear: jest.fn(async () => undefined), lastPosition: jest.fn(async () => null) };
  const pdfQueue = {
    enqueueReceipt: jest.fn(async () => undefined),
    receiptFailed: jest.fn(async () => false),
  };
  const storage = { getPrivate: jest.fn(async () => options.receipt ?? null) };
  const restaurantRecord = () => ({
    ...restaurant,
    acceptingOrders: options.accepting ?? true,
    pickupEnabled: options.pickupEnabled ?? true,
    deliveryEnabled: options.deliveryEnabled ?? true,
  });
  const zone =
    options.zone === undefined
      ? { id: "z1", restaurantId: "r1", name: "Ñuñoa", fee: 1500, minOrder: 5000, active: true, isHome: true, position: 0 }
      : options.zone;
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
    assignRider: jest.fn(async (_r: string, _o: string, rider: { id: string; name: string } | null) =>
      order({ channel: "delivery", riderId: rider?.id ?? null, riderName: rider?.name ?? null }),
    ),
    listActiveForRider: jest.fn(async () => []),
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
    {
      findById: jest.fn(async (id: string) => ({ id, name: id === "rider1" ? "Pedro Soto" : "Ana" })),
      findByIds: jest.fn(async (ids: string[]) => ids.map((id) => ({ id, name: id === "rider1" ? "Pedro Soto" : "Zoe" }))),
    } as unknown as UsersRepository,
    {
      findOne: jest.fn(async (_r: string, userId: string) =>
        options.membershipRoles === null ? null : { userId, roles: options.membershipRoles ?? ["rider"] },
      ),
      listByRestaurant: jest.fn(async () => [
        { userId: "rider1", roles: ["rider"] },
        { userId: "cook", roles: ["kitchen"] },
      ]),
    } as unknown as MembershipsRepository,
    { findOne: jest.fn(async () => zone), contains: jest.fn(async () => options.insideZone ?? true) } as unknown as DeliveryZonesRepository,
    {
      toRestaurant: () => ({ emit: (event: string) => emitted.push(`restaurant:${event}`) }),
      toStaffOf: () => ({ emit: (event: string) => emitted.push(`restaurant:${event}`) }),
      toOrder: () => ({ emit: (event: string) => emitted.push(`order:${event}`) }),
    } as unknown as RealtimeService,
    pdfQueue as unknown as PdfQueue,
    storage as unknown as StorageService,
    { transaction: (fn: (s: unknown) => Promise<unknown>) => fn({}) } as unknown as Connection,
    {
      get: (key: string) => (key === "APP_URL" ? "https://munch.test" : SECRET),
    } as unknown as ConfigService<ApiEnv, true>,
    tracking as unknown as RiderTrackingService,
    { isAvailable: jest.fn(async () => options.mapAvailable ?? true) } as unknown as MapsService,
  );
  return { service, orders, emitted, pdfQueue, storage, tracking };
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
    // Assigned to this rider, so the assignment check passes and the state machine decides.
    await expect(
      setup({ current: order({ riderId: "u1" }) }).service.changeStatus({ ...tenant, roles: ["rider"] }, "u1", "o1", "accepted"),
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

    await expect(service.markPaid({ ...tenant, roles: ["cashier"] }, "u1", "o1", "cash")).resolves.toMatchObject({
      paymentStatus: "paid",
    });
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

const deliveryInput = {
  ...pickupInput,
  items: [{ productId: "p1", quantity: 6, modifiers: [] }],
  delivery: { zoneId: "z1", address: " Av. Grecia 1234 ", unit: "Depto 5", reference: "" },
  payment: { method: "cash" as const, cashAmount: 10000 },
};

describe("OrdersService.createDelivery", () => {
  it("adds the zone fee, snapshots the address and keeps the cash amount for change", async () => {
    const { service, orders } = setup();

    await service.createDelivery("don-pepe", deliveryInput);

    expect(orders.create).toHaveBeenCalledWith(
      "r1",
      expect.objectContaining({
        channel: "delivery",
        subtotal: 6000,
        deliveryFee: 1500,
        total: 7500,
        delivery: {
          zoneId: "z1",
          zoneName: "Ñuñoa",
          address: "Av. Grecia 1234",
          unit: "Depto 5",
          reference: "",
          location: null,
        },
        expectedPayment: { method: "cash", cashAmount: 10000 },
      }),
      {},
    );
  });

  it("drops the cash amount when paying by card", async () => {
    const { service, orders } = setup();

    await service.createDelivery("don-pepe", { ...deliveryInput, payment: { method: "card_pos", cashAmount: 10000 } });

    expect(orders.create).toHaveBeenCalledWith(
      "r1",
      expect.objectContaining({ expectedPayment: { method: "card_pos", cashAmount: null } }),
      {},
    );
  });

  it.each([
    ["delivery disabled", { deliveryEnabled: false }, deliveryInput, "DELIVERY_DISABLED"],
    ["an unknown zone", { zone: null }, deliveryInput, "ZONE_NOT_AVAILABLE"],
    [
      "an inactive zone",
      { zone: { id: "z1", name: "X", fee: 0, minOrder: 0, active: false } },
      deliveryInput,
      "ZONE_NOT_AVAILABLE",
    ],
    ["a subtotal below the zone minimum", {}, { ...deliveryInput, items: [{ productId: "p1", quantity: 2, modifiers: [] }] }, "BELOW_MINIMUM_ORDER"],
    ["cash that does not cover the total", {}, { ...deliveryInput, payment: { method: "cash" as const, cashAmount: 7000 } }, "CASH_AMOUNT_TOO_LOW"],
    ["too many orders for the phone", { activeByPhone: 3 }, deliveryInput, "TOO_MANY_ACTIVE_ORDERS"],
  ])("refuses %s", async (_, cfg, body, code) => {
    await expect(setup(cfg as Parameters<typeof setup>[0]).service.createDelivery("don-pepe", body)).rejects.toMatchObject({
      response: { code },
    });
  });
});

const deliveryOrder = (overrides: Partial<OrderRecord> = {}) =>
  pickupOrder({
    channel: "delivery",
    deliveryFee: 1500,
    total: 7500,
    delivery: { zoneId: "z1", zoneName: "Ñuñoa", address: "Av. Grecia 1234", unit: "", reference: "", location: null },
    expectedPayment: { method: "cash", cashAmount: 10000 },
    ...overrides,
  });

describe("OrdersService delivery handling", () => {
  const rider: TenantContext = { restaurantId: "r1", roles: ["rider"], status: "active" };

  it("asks for an ETA from the delivery choices when accepting", async () => {
    const { service } = setup({ current: deliveryOrder() });

    await expect(service.changeStatus(tenant, "u1", "o1", "accepted", undefined, 10)).rejects.toMatchObject({
      response: { code: "READY_TIME_REQUIRED" },
    });
    await expect(service.changeStatus(tenant, "u1", "o1", "accepted", undefined, 45)).resolves.toMatchObject({
      status: "accepted",
      receiptAvailable: true,
    });
  });

  it("shows the change the rider must bring", async () => {
    const { service } = setup({ current: deliveryOrder() });

    const view = await service.get(tenant, "o1");

    expect(view.expectedPayment).toEqual({ method: "cash", cashAmount: 10000, change: 2500 });
  });

  it("lets riders act only on their own deliveries", async () => {
    const mine = deliveryOrder({ status: "ready", riderId: "rider1", riderName: "Pedro Soto" });
    await expect(
      setup({ current: mine }).service.changeStatus(rider, "rider1", "o1", "out_for_delivery"),
    ).resolves.toMatchObject({ status: "out_for_delivery" });
    await expect(
      setup({ current: mine }).service.changeStatus(rider, "someone-else", "o1", "out_for_delivery"),
    ).rejects.toMatchObject({ response: { code: "NOT_YOUR_DELIVERY" } });
    await expect(
      setup({ current: deliveryOrder({ status: "ready" }) }).service.changeStatus(rider, "rider1", "o1", "out_for_delivery"),
    ).rejects.toMatchObject({ response: { code: "NOT_YOUR_DELIVERY" } });
  });

  it("lets a rider collect the payment of their delivery, and nothing else", async () => {
    const mine = deliveryOrder({ status: "out_for_delivery", riderId: "rider1" });
    await expect(setup({ current: mine }).service.markPaid(rider, "rider1", "o1", "cash")).resolves.toMatchObject({
      paymentStatus: "paid",
    });
    await expect(setup({ current: mine }).service.markPaid(rider, "other", "o1", "cash")).rejects.toMatchObject({
      response: { code: "NOT_YOUR_DELIVERY" },
    });
    await expect(setup().service.markPaid(rider, "rider1", "o1", "cash")).rejects.toMatchObject({
      response: { code: "NOT_YOUR_DELIVERY" },
    });
  });

  it("assigns only members with the rider role, and tells the customer the rider's first name", async () => {
    const { service, orders, emitted } = setup();

    const view = await service.assignRider(tenant, "o1", "rider1");

    expect(orders.assignRider).toHaveBeenCalledWith("r1", "o1", { id: "rider1", name: "Pedro Soto" });
    expect(view.rider).toEqual({ id: "rider1", name: "Pedro Soto" });
    expect(emitted).toEqual(["restaurant:order.updated", "order:order.status"]);
    await expect(setup({ membershipRoles: ["kitchen"] }).service.assignRider(tenant, "o1", "cook")).rejects.toMatchObject({
      response: { code: "NOT_A_RIDER" },
    });
    await expect(setup().service.assignRider(tenant, "o1", null)).resolves.toMatchObject({ rider: null });
  });

  it("lists only riders for the picker", async () => {
    await expect(setup().service.listRiders("r1")).resolves.toEqual([{ id: "rider1", name: "Pedro Soto" }]);
  });

  it("puts the fee, address and expected payment on the receipt", async () => {
    const { service, pdfQueue } = setup({ current: deliveryOrder() });

    await service.changeStatus(tenant, "u1", "o1", "accepted", undefined, 30);

    expect(pdfQueue.enqueueReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        receipt: expect.objectContaining({
          channel: "delivery",
          deliveryFee: 1500,
          delivery: expect.objectContaining({ zoneName: "Ñuñoa" }),
          expectedPayment: { method: "cash", cashAmount: 10000, change: 2500 },
        }),
      }),
    );
  });
});

describe("OrdersService items per order", () => {
  it("rejects carts with more units than the restaurant allows", async () => {
    const big = { ...input, items: [{ productId: "p1", quantity: 6, modifiers: [] }, { productId: "p1", quantity: 5, modifiers: [] }] };

    await expect(setup().service.createDineIn("abc", big)).rejects.toMatchObject({
      response: { code: "TOO_MANY_ITEMS", meta: { max: "10" } },
    });
  });

  it("accepts exactly the limit", async () => {
    const full = { ...input, items: [{ productId: "p1", quantity: 10, modifiers: [] }] };

    await expect(setup().service.createDineIn("abc", full)).resolves.toBeDefined();
  });
});

describe("OrdersService delivery pin", () => {
  const drawn = { id: "z1", name: "Ñuñoa", fee: 1500, minOrder: 0, active: true, area: [{ lat: 0, lng: 0 }] };
  const pinned = { ...deliveryInput, delivery: { ...deliveryInput.delivery, location: { lat: -33.4561234567, lng: -70.6 } } };

  it("asks for a pin when the zone is drawn on the map", async () => {
    await expect(setup({ zone: drawn }).service.createDelivery("don-pepe", deliveryInput)).rejects.toMatchObject({
      response: { code: "LOCATION_REQUIRED" },
    });
  });

  it("rejects a pin outside the zone", async () => {
    await expect(
      setup({ zone: drawn, insideZone: false }).service.createDelivery("don-pepe", pinned),
    ).rejects.toMatchObject({ response: { code: "OUTSIDE_ZONE" } });
  });

  it("stores the pin, rounded, when it is inside", async () => {
    const { service, orders } = setup({ zone: drawn, insideZone: true });

    await service.createDelivery("don-pepe", pinned);

    expect(orders.create).toHaveBeenCalledWith(
      "r1",
      expect.objectContaining({ delivery: expect.objectContaining({ location: { lat: -33.456123, lng: -70.6 } }) }),
      {},
    );
  });

  it("does not ask for a pin while the base map is not uploaded (no way to place one)", async () => {
    await expect(setup({ zone: drawn, mapAvailable: false }).service.createDelivery("don-pepe", deliveryInput)).resolves.toBeDefined();
    await expect(
      setup({ zone: drawn, mapAvailable: false, insideZone: false }).service.createDelivery("don-pepe", pinned),
    ).rejects.toMatchObject({ response: { code: "OUTSIDE_ZONE" } });
  });

  it("does not need a pin for zones chosen by name", async () => {
    await expect(setup().service.createDelivery("don-pepe", deliveryInput)).resolves.toBeDefined();
  });
});

describe("OrdersService rider position", () => {
  it("forgets the rider's position once the delivery is handed over", async () => {
    const onTheWay = order({ channel: "delivery", status: "out_for_delivery", riderId: "u1" });
    const { service, tracking } = setup({ current: onTheWay });

    await service.changeStatus({ ...tenant, roles: ["kitchen"] }, "u1", "o1", "delivered");

    expect(tracking.clear).toHaveBeenCalledWith("o1");
  });

  it("only shows a position while the delivery is on its way", async () => {
    const { service, tracking } = setup({ current: order({ channel: "delivery", status: "ready" }) });

    await expect(service.riderPositionForCustomer("tok")).resolves.toBeNull();
    expect(tracking.lastPosition).not.toHaveBeenCalled();
  });
});
