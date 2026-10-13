import type { ConfigService } from "@nestjs/config";
import type { PinoLogger } from "nestjs-pino";
import type { ApiEnv } from "../../config/env.validation";
import type { NotifQueue } from "../../infra/queue/notif.queue";
import type { MembershipsRepository } from "../restaurants/memberships.repository";
import type { PushSubscriptionsRepository } from "./push-subscriptions.repository";
import { type NotifiableOrder, PushService } from "./push.service";

const target = (n: number) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${n}`, keys: { p256dh: "p", auth: "a" } });
const order: NotifiableOrder = {
  id: "o1",
  restaurantId: "r1",
  ticketNumber: 12,
  channel: "pickup",
  tableLabel: null,
  total: 10470,
  currency: "CLP",
};

function setup(options: { publicKey?: string | null; failQueue?: boolean } = {}) {
  const subscriptions = {
    saveForUser: jest.fn(async () => undefined),
    saveForOrder: jest.fn(async () => undefined),
    deleteForUser: jest.fn(async () => undefined),
    listForUsers: jest.fn(async (ids: string[]) => ids.map((_, i) => target(i))),
    listForOrder: jest.fn(async () => [target(9)]),
  };
  const memberships = {
    listByRestaurant: jest.fn(async () => [
      { userId: "owner", roles: ["owner"] },
      { userId: "cook", roles: ["kitchen"] },
      { userId: "rider", roles: ["rider"] },
    ]),
  };
  const queue = {
    push: jest.fn(async () => {
      if (options.failQueue) throw new Error("valkey down");
    }),
  };
  const logger = { warn: jest.fn() };
  const service = new PushService(
    subscriptions as unknown as PushSubscriptionsRepository,
    memberships as unknown as MembershipsRepository,
    queue as unknown as NotifQueue,
    logger as unknown as PinoLogger,
    {
      get: () => (options.publicKey === undefined ? "BPublicKey" : options.publicKey ?? undefined),
    } as unknown as ConfigService<ApiEnv, true>,
  );
  return { service, subscriptions, queue, logger };
}

describe("PushService", () => {
  it("announces a new order to the board staff only, once per order", async () => {
    const { service, subscriptions, queue } = setup();

    await service.newOrder(order);

    expect(subscriptions.listForUsers).toHaveBeenCalledWith(["owner", "cook"]);
    expect(queue.push).toHaveBeenCalledWith(
      {
        subscriptions: [target(0), target(1)],
        notification: { title: "Pedido nuevo #12", body: "Para retirar · $10.470", url: "/admin/r1/pedidos", tag: "order-o1" },
      },
      "push-created-o1",
    );
  });

  it("tells the order's followers it is ready, and the rider about an assignment", async () => {
    const { service, queue } = setup();

    await service.customerUpdate(order, "ready", "/pedido#t=tok");
    await service.riderAssigned(order, "rider");

    expect(queue.push).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ notification: expect.objectContaining({ title: "Tu pedido #12 está listo", url: "/pedido#t=tok" }) }),
      "push-ready-o1",
    );
    expect(queue.push).toHaveBeenNthCalledWith(2, expect.anything(), "push-rider-o1-rider");
  });

  it("enqueues nothing without VAPID keys, and refuses subscriptions then", async () => {
    const { service, queue } = setup({ publicKey: null });

    await service.newOrder(order);

    expect(queue.push).not.toHaveBeenCalled();
    expect(service.config()).toEqual({ publicKey: null });
    await expect(service.subscribeUser("u1", target(1))).rejects.toMatchObject({ response: { code: "PUSH_NOT_CONFIGURED" } });
  });

  it("only accepts endpoints of real push services", async () => {
    const { service, subscriptions } = setup();

    await expect(
      service.followOrder("o1", { endpoint: "https://valkey:6379/x", keys: { p256dh: "p", auth: "a" } }),
    ).rejects.toMatchObject({ response: { code: "INVALID_PUSH_ENDPOINT" } });
    await service.followOrder("o1", target(1));
    expect(subscriptions.saveForOrder).toHaveBeenCalledWith("o1", target(1), expect.any(Date));
  });

  it("never breaks the order flow when the queue fails", async () => {
    const { service, logger } = setup({ failQueue: true });

    await expect(service.newOrder(order)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });
});
