import type { MessagingSettings } from "@app/types";
import type { ConfigService } from "@nestjs/config";
import type { PinoLogger } from "nestjs-pino";
import type { ApiEnv } from "../../config/env.validation";
import type { NotifQueue } from "../../infra/queue/notif.queue";
import { MessagingService } from "./messaging.service";
import { type MessageOrderFacts, orderMessage } from "./order-messages";

const facts = (over: Partial<MessageOrderFacts> = {}): MessageOrderFacts => ({
  restaurantName: "Pizzería Forno Rosso",
  ticketNumber: 12,
  channel: "pickup",
  // 23:45 UTC = 20:45 in Santiago.
  estimatedReadyAt: new Date("2026-10-13T23:45:00Z"),
  timezone: "America/Santiago",
  riderName: null,
  reason: null,
  trackingUrl: "https://munch.test/pedido#t=abc",
  ...over,
});

describe("orderMessage", () => {
  it("starts with the restaurant and ends with the tracking link", () => {
    const text = orderMessage("accepted", facts());
    expect(text).toBe("Pizzería Forno Rosso: aceptamos tu pedido #12. Estará listo a las 20:45. Síguelo en https://munch.test/pedido#t=abc");
  });

  it("says when a delivery arrives, who brings it and why an order was not accepted", () => {
    expect(orderMessage("accepted", facts({ channel: "delivery" }))).toContain("Llega aprox. a las 20:45.");
    expect(orderMessage("on_the_way", facts({ channel: "delivery", riderName: "Rodrigo Reparto" }))).toContain(
      "tu pedido #12 va en camino con Rodrigo.",
    );
    expect(orderMessage("ready", facts())).toContain("tu pedido #12 está listo para retirar.");
    expect(orderMessage("rejected", facts({ reason: "Nos quedamos sin masa" }))).toContain(
      "no pudimos aceptar tu pedido #12: Nos quedamos sin masa",
    );
    expect(orderMessage("cancelled", facts({ reason: null }))).toContain("tu pedido #12 fue cancelado.");
  });
});

describe("MessagingService", () => {
  const settings = (over: Partial<MessagingSettings> = {}) => ({
    messaging: { enabled: true, channel: "whatsapp" as const, senderPhone: "+56987654321", ...over },
  });

  function setup(provider: "off" | "twilio" | "mailpit" = "twilio", fail = false) {
    const queue = { message: jest.fn(async () => (fail ? Promise.reject(new Error("valkey down")) : undefined)) };
    const logger = { warn: jest.fn() };
    const service = new MessagingService(
      queue as unknown as NotifQueue,
      logger as unknown as PinoLogger,
      { get: () => provider } as unknown as ConfigService<ApiEnv, true>,
    );
    return { service, queue, logger };
  }

  it("offers the restaurant's channel only with a provider, the switch on and a sender number", () => {
    expect(setup().service.offeredChannel(settings())).toBe("whatsapp");
    expect(setup().service.offeredChannel(settings({ channel: "sms" }))).toBe("sms");
    expect(setup("off").service.offeredChannel(settings())).toBeNull();
    expect(setup().service.offeredChannel(settings({ enabled: false }))).toBeNull();
    expect(setup().service.offeredChannel(settings({ senderPhone: "" }))).toBeNull();
  });

  const order = { id: "o1", restaurantId: "r1", customerPhone: "+56912345678", notifyBy: "whatsapp" as const };

  it("queues the notice from the restaurant's number to the customer", async () => {
    const { service, queue } = setup();
    await service.orderEvent(order, settings(), "accepted", facts());
    expect(queue.message).toHaveBeenCalledWith({
      restaurantId: "r1",
      orderId: "o1",
      event: "accepted",
      channel: "whatsapp",
      from: "+56987654321",
      to: "+56912345678",
      text: expect.stringContaining("aceptamos tu pedido #12"),
    });
  });

  it("does nothing when the customer did not ask, or the restaurant stopped sending", async () => {
    const { service, queue } = setup();
    await service.orderEvent({ ...order, notifyBy: null }, settings(), "accepted", facts());
    await service.orderEvent(order, settings({ enabled: false }), "accepted", facts());
    expect(queue.message).not.toHaveBeenCalled();
  });

  it("never breaks the order flow when the queue fails", async () => {
    const { service, logger } = setup("twilio", true);
    await expect(service.orderEvent(order, settings(), "ready", facts())).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });
});
