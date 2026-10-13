import type { OrderChannel, OrderMessageEvent } from "@app/types";

/** What a notice needs to know about the order (kept independent from the orders module). */
export interface MessageOrderFacts {
  restaurantName: string;
  ticketNumber: number;
  channel: OrderChannel;
  /** When it will be ready (pickup) or arrive (delivery), if set. */
  estimatedReadyAt: Date | null;
  timezone: string;
  riderName: string | null;
  /** Rejection or cancellation reason. */
  reason: string | null;
  /** Absolute link to the tracking page. */
  trackingUrl: string;
}

/** "20:45" in the restaurant's timezone. */
function clock(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("es-CL", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
}

/**
 * The text of an order notice by WhatsApp or SMS, in Spanish. Short (SMS segments are 160 characters with
 * plain text) and always starting with the restaurant's name, so the customer knows who writes.
 */
export function orderMessage(event: OrderMessageEvent, facts: MessageOrderFacts): string {
  const order = `tu pedido #${facts.ticketNumber}`;
  const time = facts.estimatedReadyAt ? clock(facts.estimatedReadyAt, facts.timezone) : null;
  let body: string;
  switch (event) {
    case "accepted":
      body =
        facts.channel === "delivery"
          ? `aceptamos ${order}${time ? `. Llega aprox. a las ${time}` : ""}.`
          : `aceptamos ${order}${time ? `. Estará listo a las ${time}` : ""}.`;
      break;
    case "ready":
      body = `${order} está listo para retirar.`;
      break;
    case "on_the_way":
      body = `${order} va en camino${facts.riderName ? ` con ${facts.riderName.split(" ")[0]}` : ""}.`;
      break;
    case "rejected":
      body = `no pudimos aceptar ${order}${facts.reason ? `: ${facts.reason}` : "."}`;
      break;
    case "cancelled":
      body = `${order} fue cancelado${facts.reason ? `: ${facts.reason}` : "."}`;
      break;
  }
  return `${facts.restaurantName}: ${body} Síguelo en ${facts.trackingUrl}`;
}
