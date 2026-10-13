import type { MessageJob } from "@app/types";
import type { ConfigService } from "@nestjs/config";
import { UnrecoverableError } from "bullmq";
import type { Connection } from "mongoose";
import type { PinoLogger } from "nestjs-pino";
import type { WorkersEnv } from "../config/env.validation";
import type { MailerService } from "../email/mailer.service";
import { MessageSenderService } from "./message-sender.service";

const message: MessageJob = {
  restaurantId: "r1",
  orderId: "o1",
  event: "accepted",
  channel: "whatsapp",
  from: "+56987654321",
  to: "+56912345678",
  text: "Pizzería Forno Rosso: aceptamos tu pedido #12. Síguelo en https://munch.test/pedido#t=abc",
};

function setup(provider: "off" | "twilio" | "mailpit", options: { credentials?: boolean } = {}) {
  // An in-memory `sent_messages` collection, so the same job can run twice.
  const log = new Map<string, unknown>();
  const collection = {
    findOne: jest.fn(async ({ _id }: { _id: string }) => log.get(_id) ?? null),
    updateOne: jest.fn(async ({ _id }: { _id: string }, update: { $setOnInsert: unknown }) => {
      if (!log.has(_id)) log.set(_id, update.$setOnInsert);
    }),
  };
  const env: Record<string, string | undefined> = {
    MESSAGING_PROVIDER: provider,
    TWILIO_ACCOUNT_SID: options.credentials === false ? undefined : "AC123",
    TWILIO_AUTH_TOKEN: options.credentials === false ? undefined : "secret",
    TWILIO_API_URL: "https://twilio.test",
  };
  const mailer = { send: jest.fn(async () => "<mail-1@mailpit>") };
  const logger = { info: jest.fn(), warn: jest.fn() };
  const service = new MessageSenderService(
    { get: (name: string) => env[name] } as unknown as ConfigService<WorkersEnv, true>,
    mailer as unknown as MailerService,
    { collection: () => collection } as unknown as Connection,
    logger as unknown as PinoLogger,
  );
  return { service, mailer, logger, collection, log };
}

describe("MessageSenderService", () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it("sends WhatsApp through Twilio with the whatsapp: prefix and basic auth", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({ sid: "SM42" }) });

    await expect(setup("twilio").service.send("msg-o1-accepted", message)).resolves.toEqual({ status: "sent", providerId: "SM42" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://twilio.test/2010-04-01/Accounts/AC123/Messages.json");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("AC123:secret").toString("base64")}`);
    const body = new URLSearchParams(String(init.body));
    expect(body.get("From")).toBe("whatsapp:+56987654321");
    expect(body.get("To")).toBe("whatsapp:+56912345678");
    expect(body.get("Body")).toBe(message.text);
  });

  it("sends SMS without the prefix", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({ sid: "SM43" }) });
    await setup("twilio").service.send("msg-o1-ready", { ...message, channel: "sms", event: "ready" });
    const body = new URLSearchParams(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body.get("To")).toBe("+56912345678");
  });

  it("is idempotent: the same job processed twice sends once", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({ sid: "SM44" }) });
    const { service } = setup("twilio");

    await expect(service.send("msg-o1-accepted", message)).resolves.toMatchObject({ status: "sent" });
    await expect(service.send("msg-o1-accepted", message)).resolves.toEqual({ status: "already_sent" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry answers that will never work, retries the rest", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ code: 21211, message: "Invalid 'To' Phone Number" }) });
    await expect(setup("twilio").service.send("msg-o1-accepted", message)).rejects.toBeInstanceOf(UnrecoverableError);

    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) });
    const failure = setup("twilio").service.send("msg-o1-accepted", message);
    await expect(failure).rejects.toThrow("Twilio 503");
    await expect(failure).rejects.not.toBeInstanceOf(UnrecoverableError);
  });

  it("fails without credentials instead of pretending to send", async () => {
    await expect(setup("twilio", { credentials: false }).service.send("msg-o1-accepted", message)).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });

  it("delivers to Mailpit on local stacks, recording only ids", async () => {
    const { service, mailer, log } = setup("mailpit");

    await expect(service.send("msg-o1-accepted", message)).resolves.toEqual({ status: "sent", providerId: "<mail-1@mailpit>" });

    expect(mailer.send).toHaveBeenCalledWith(
      "56912345678@whatsapp.mensajes.local",
      expect.objectContaining({ subject: "[WhatsApp] de +56987654321 para +56912345678", text: message.text }),
    );
    expect(JSON.stringify([...log.values()])).not.toContain("912345678");
  });

  it("skips quietly when no provider is configured", async () => {
    const { service, logger } = setup("off");
    await expect(service.send("msg-o1-accepted", message)).resolves.toEqual({ status: "skipped" });
    expect(logger.warn).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
