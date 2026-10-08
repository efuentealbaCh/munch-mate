import type { EmailJob } from "@app/types";
import type { Job } from "bullmq";
import type { PinoLogger } from "nestjs-pino";
import type { PrivateStorageService } from "../storage/private-storage.service";
import { EmailProcessor } from "./email.processor";
import type { MailerService } from "./mailer.service";

function setup() {
  const mailer = { send: jest.fn(async () => "<message@id>") };
  const storage = { get: jest.fn(async () => Buffer.from("%PDF-1.7")) };
  const logger = { info: jest.fn() };
  const processor = new EmailProcessor(
    mailer as unknown as MailerService,
    storage as unknown as PrivateStorageService,
    logger as unknown as PinoLogger,
  );
  const run = (data: EmailJob) => processor.process({ id: "1", data } as unknown as Job<EmailJob>);
  return { run, mailer, storage, logger };
}

describe("EmailProcessor", () => {
  it("sends emails without attachments as rendered", async () => {
    const { run, mailer, storage } = setup();

    await expect(
      run({ template: "verify-email", data: { to: "ana@example.com", name: "Ana", url: "https://x.test/v?token=a" } }),
    ).resolves.toEqual({ messageId: "<message@id>" });

    expect(mailer.send).toHaveBeenCalledWith("ana@example.com", expect.objectContaining({ subject: expect.any(String) }), []);
    expect(storage.get).not.toHaveBeenCalled();
  });

  it("attaches the stored receipt to the order confirmation and logs no customer data", async () => {
    const { run, mailer, storage, logger } = setup();

    await run({
      template: "order-confirmation",
      data: {
        to: "berta@example.com",
        customerName: "Berta",
        restaurantName: "Don Pepe",
        restaurantPhone: "",
        ticketNumber: 3,
        readyAt: "14:03",
        total: "$6.980",
        trackingUrl: "https://munch.test/pedido#t=tok",
        attachment: { key: "restaurants/r1/receipts/o1.pdf", filename: "comprobante-pedido-41.pdf" },
      },
    });

    expect(storage.get).toHaveBeenCalledWith("restaurants/r1/receipts/o1.pdf");
    expect(mailer.send).toHaveBeenCalledWith("berta@example.com", expect.not.objectContaining({ attachments: expect.anything() }), [
      { filename: "comprobante-pedido-41.pdf", contentType: "application/pdf", content: Buffer.from("%PDF-1.7") },
    ]);
    expect(JSON.stringify(logger.info.mock.calls)).not.toMatch(/berta|tok/);
  });

  it("fails the job (so BullMQ retries) when the attachment cannot be read", async () => {
    const { run, mailer, storage } = setup();
    storage.get.mockRejectedValueOnce(new Error("NoSuchKey"));

    await expect(
      run({
        template: "order-confirmation",
        data: {
          to: "berta@example.com",
          customerName: "Berta",
          restaurantName: "Don Pepe",
          restaurantPhone: "",
          ticketNumber: 3,
          readyAt: null,
          total: "$6.980",
          trackingUrl: "https://munch.test/pedido#t=tok",
          attachment: { key: "missing.pdf", filename: "c.pdf" },
        },
      }),
    ).rejects.toThrow("NoSuchKey");
    expect(mailer.send).not.toHaveBeenCalled();
  });
});
