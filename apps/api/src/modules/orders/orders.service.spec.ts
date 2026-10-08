import type { ConfigService } from "@nestjs/config";
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
    note: "",
    tableId: "t1",
    tableLabel: "Mesa 4",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function setup(options: { accepting?: boolean; existing?: OrderRecord | null; current?: OrderRecord | null } = {}) {
  const emitted: string[] = [];
  const orders = {
    findByClientOrderId: jest.fn(async () => options.existing ?? null),
    create: jest.fn(async () => order()),
    findOne: jest.fn(async () => (options.current === undefined ? order() : options.current)),
    findByAccessTokenHash: jest.fn(async () => (options.current === undefined ? order() : options.current)),
    transition: jest.fn(async (_r: string, _o: string, _from: string, change: { to: string }) =>
      order({ status: change.to as OrderRecord["status"] }),
    ),
    listActive: jest.fn(async () => [order()]),
    listByBusinessDate: jest.fn(async () => []),
    markPaid: jest.fn(async () => order({ paymentStatus: "paid", paymentMethod: "cash" })),
  };
  const service = new OrdersService(
    orders as unknown as OrdersRepository,
    { next: jest.fn(async () => 1) } as unknown as CountersRepository,
    { findByToken: jest.fn(async () => table) } as unknown as TablesRepository,
    {
      findById: jest.fn(async () => ({ ...restaurant, acceptingOrders: options.accepting ?? true })),
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
    { transaction: (fn: (s: unknown) => Promise<unknown>) => fn({}) } as unknown as Connection,
    { get: () => SECRET } as unknown as ConfigService<ApiEnv, true>,
  );
  return { service, orders, emitted };
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
