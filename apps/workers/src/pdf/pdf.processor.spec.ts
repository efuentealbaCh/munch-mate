import type { EmailJob, QrSheetJob, ReceiptJob } from "@app/types";
import type { Queue } from "bullmq";
import type { PinoLogger } from "nestjs-pino";
import type { RealtimeEmitterService } from "../realtime/realtime-emitter.service";
import type { PrivateStorageService } from "../storage/private-storage.service";
import { PdfProcessor } from "./pdf.processor";

const receiptJob: ReceiptJob = {
  restaurantId: "r1",
  orderId: "o1",
  outputKey: "restaurants/r1/receipts/o1.pdf",
  receipt: {
    restaurant: { name: "Don Pepe", phone: "" },
    number: 41,
    ticketNumber: 3,
    channel: "pickup",
    createdAt: "2026-10-07T16:48:00Z",
    estimatedReadyAt: "2026-10-07T17:03:00Z",
    timezone: "America/Santiago",
    customerName: "Berta",
    customerPhone: "+56912345678",
    items: [{ productId: "p1", name: "Completo", unitPrice: 3490, quantity: 2, modifiers: [], note: "", lineTotal: 6980 }],
    subtotal: 6980,
    deliveryFee: 0,
    total: 6980,
    currency: "CLP",
    delivery: null,
    expectedPayment: null,
    note: "",
  },
  email: { to: "berta@example.com", trackingUrl: "https://munch.test/pedido#t=tok" },
};

function setup() {
  const stored: { key: string; contentType: string; bytes: Buffer }[] = [];
  const emitted: { rooms: string[]; event: string; payload: unknown }[] = [];
  const emailQueue = { add: jest.fn(async () => ({})) };
  const roomEmitter = (rooms: string[]) => ({
    emit: (event: string, payload: unknown) => emitted.push({ rooms, event, payload }),
  });
  const processor = new PdfProcessor(
    {
      put: jest.fn(async (key: string, bytes: Buffer, contentType: string) => {
        stored.push({ key, contentType, bytes });
      }),
    } as unknown as PrivateStorageService,
    {
      toRestaurant: (id: string) => roomEmitter([`restaurant:${id}`]),
      toRestaurantAndOrder: (id: string, orderId: string) => roomEmitter([`restaurant:${id}`, `order:${orderId}`]),
    } as unknown as RealtimeEmitterService,
    emailQueue as unknown as Queue<EmailJob>,
    { info: jest.fn() } as unknown as PinoLogger,
  );
  const run = (name: string, data: unknown, id = "job-1") =>
    processor.process({ name, data, id } as unknown as Parameters<PdfProcessor["process"]>[0]);
  return { run, stored, emitted, emailQueue };
}

describe("PdfProcessor", () => {
  it("stores the receipt, announces it to the staff and the customer, and enqueues the email", async () => {
    const { run, stored, emitted, emailQueue } = setup();

    await expect(run("receipt", receiptJob)).resolves.toEqual({ key: receiptJob.outputKey });

    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ key: receiptJob.outputKey, contentType: "application/pdf" });
    expect(stored[0]!.bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(emitted).toEqual([
      { rooms: ["restaurant:r1", "order:o1"], event: "order.receipt-ready", payload: { orderId: "o1" } },
    ]);
    expect(emailQueue.add).toHaveBeenCalledWith(
      "order-confirmation",
      {
        template: "order-confirmation",
        data: expect.objectContaining({
          to: "berta@example.com",
          ticketNumber: 3,
          readyAt: "14:03",
          total: "$6.980",
          trackingUrl: "https://munch.test/pedido#t=tok",
          attachment: { key: receiptJob.outputKey, filename: "comprobante-pedido-41.pdf" },
        }),
      },
      expect.objectContaining({ jobId: "order-confirmation-o1" }),
    );
  });

  it("is idempotent: a second run overwrites the same key and reuses the email job id", async () => {
    const { run, stored, emailQueue } = setup();

    await run("receipt", receiptJob, "job-1");
    await run("receipt", receiptJob, "job-2");

    expect(new Set(stored.map((s) => s.key))).toEqual(new Set([receiptJob.outputKey]));
    const jobIds = emailQueue.add.mock.calls.map((call) => (call as unknown[])[2] as { jobId: string });
    expect(new Set(jobIds.map((options) => options.jobId))).toEqual(new Set(["order-confirmation-o1"]));
  });

  it("sends no email when the customer left none", async () => {
    const { run, emailQueue, emitted } = setup();

    await run("receipt", { ...receiptJob, email: null });

    expect(emailQueue.add).not.toHaveBeenCalled();
    expect(emitted).toHaveLength(1);
  });

  it("renders the QR sheet and tells the restaurant which job finished", async () => {
    const { run, stored, emitted } = setup();
    const job: QrSheetJob = {
      restaurantId: "r1",
      restaurantName: "Don Pepe",
      tables: [{ label: "Mesa 1", url: "https://munch.test/m/abcdefghjk" }],
      outputKey: "restaurants/r1/qr-sheets/x.pdf",
    };

    await run("qr-sheet", job, "qr-sheet-x");

    expect(stored[0]!.key).toBe(job.outputKey);
    expect(emitted).toEqual([
      { rooms: ["restaurant:r1"], event: "qr-sheet.ready", payload: { restaurantId: "r1", jobId: "qr-sheet-x" } },
    ]);
  });

  it("fails unknown jobs so they land in the failed set", async () => {
    await expect(setup().run("nope", {})).rejects.toThrow('Unknown job "nope"');
  });
});
