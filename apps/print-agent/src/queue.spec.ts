import type { PrintJobPayload, PrintResultInput } from "@app/types";
import { INVALID_JOB, JobProcessor, PRINTER_NOT_FOUND, PRINTED_MEMORY, errorText, parseJob } from "./jobs";
import { silentLogger } from "./logger";
import type { LocalPrinter } from "./printers/types";
import { LruSet, SerialQueues } from "./queue";

const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("SerialQueues", () => {
  it("runs tasks of one key one after another and different keys in parallel", async () => {
    const queues = new SerialQueues();
    const log: string[] = [];
    const first = deferred();
    const a1 = queues.run("a", async () => {
      log.push("a1 start");
      await first.promise;
      log.push("a1 end");
    });
    const a2 = queues.run("a", async () => {
      log.push("a2");
    });
    const b1 = queues.run("b", async () => {
      log.push("b1");
    });
    await b1;
    await flush();
    expect(log).toEqual(["a1 start", "b1"]);
    first.resolve();
    await Promise.all([a1, a2]);
    expect(log).toEqual(["a1 start", "b1", "a1 end", "a2"]);
  });

  it("keeps going after a failed task and forgets idle keys", async () => {
    const queues = new SerialQueues();
    const failed = queues.run("a", async () => {
      throw new Error("sin papel");
    });
    const next = queues.run("a", async () => "ok");
    await expect(failed).rejects.toThrow("sin papel");
    await expect(next).resolves.toBe("ok");
    await queues.idle();
    await flush();
    expect(queues.size).toBe(0);
  });
});

describe("LruSet", () => {
  it("keeps only the last values added", () => {
    const set = new LruSet(2);
    set.add("a");
    set.add("b");
    set.add("a"); // refreshed
    set.add("c");
    expect([set.has("a"), set.has("b"), set.has("c"), set.size]).toEqual([true, false, true, 2]);
  });
});

const job = (overrides: Partial<PrintJobPayload> = {}): PrintJobPayload => ({
  jobId: "65a1b2c3d4e5f60718293a4b",
  printerKey: "usb:Cocina",
  paper: "80",
  copies: 1,
  kind: "kitchen",
  layout: { columns: 48, lines: [{ text: "#1", align: "center", bold: true, size: 2 }], cut: true },
  queuedAt: "2026-10-13T12:00:00.000Z",
  ...overrides,
});

function setup(printerKeys = ["usb:Cocina", "usb:Barra"]) {
  const sent: { key: string; data: Buffer }[] = [];
  const gates = new Map<string, ReturnType<typeof deferred>>();
  let failNext: Error | null = null;
  const printers = new Map<string, LocalPrinter>(
    printerKeys.map((key) => [
      key,
      {
        key,
        name: key,
        kind: "usb",
        send: async (data: Buffer) => {
          await gates.get(key)?.promise;
          if (failNext) {
            const error = failNext;
            failNext = null;
            throw error;
          }
          sent.push({ key, data });
        },
      },
    ]),
  );
  const results: PrintResultInput[] = [];
  const refresh = jest.fn(async () => false);
  const processor = new JobProcessor({
    printers: { find: (key) => printers.get(key), refresh },
    logger: silentLogger,
    sendResult: (result) => results.push(result),
  });
  return {
    processor,
    sent,
    results,
    refresh,
    gate: (key: string) => {
      const gate = deferred();
      gates.set(key, gate);
      return gate;
    },
    failNextWith: (error: Error) => {
      failNext = error;
    },
  };
}

describe("JobProcessor", () => {
  it("prints a job and confirms it", async () => {
    const { processor, sent, results } = setup();
    processor.handle(job());
    await processor.idle();
    await flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.data.subarray(0, 5)).toEqual(Buffer.from([0x1b, 0x40, 0x1b, 0x74, 19]));
    expect(results).toEqual([{ jobId: job().jobId, ok: true }]);
  });

  it("confirms a job printed before without printing it again", async () => {
    const { processor, sent, results } = setup();
    processor.handle(job());
    await processor.idle();
    await flush();
    processor.handle(job());
    await processor.idle();
    expect(sent).toHaveLength(1);
    expect(results).toEqual([
      { jobId: job().jobId, ok: true },
      { jobId: job().jobId, ok: true },
    ]);
  });

  it("ignores a copy that arrives while the job is still printing", async () => {
    const { processor, sent, results, gate } = setup();
    const busy = gate("usb:Cocina");
    processor.handle(job());
    processor.handle(job());
    busy.resolve();
    await processor.idle();
    await flush();
    expect(sent).toHaveLength(1);
    expect(results).toHaveLength(1);
  });

  it("prints jobs of one printer in order, one at a time", async () => {
    const { processor, sent, gate } = setup();
    const busy = gate("usb:Cocina");
    processor.handle(job({ jobId: "a".repeat(24) }));
    processor.handle(job({ jobId: "b".repeat(24) }));
    processor.handle(job({ jobId: "c".repeat(24), printerKey: "usb:Barra" }));
    await flush();
    await flush();
    expect(sent.map((entry) => entry.key)).toEqual(["usb:Barra"]);
    busy.resolve();
    await processor.idle();
    expect(sent.map((entry) => entry.key)).toEqual(["usb:Barra", "usb:Cocina", "usb:Cocina"]);
  });

  it("rescans once and reports a printer that is not on this computer", async () => {
    const { processor, results, refresh } = setup();
    processor.handle(job({ printerKey: "net:10.0.0.9:9100" }));
    await processor.idle();
    await flush();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(results).toEqual([{ jobId: job().jobId, ok: false, error: PRINTER_NOT_FOUND }]);
  });

  it("reports a printer error and prints the job again if the server re-sends it", async () => {
    const { processor, sent, results, failNextWith } = setup();
    failNextWith(new Error("La impresora   no\nresponde"));
    processor.handle(job());
    await processor.idle();
    await flush();
    processor.handle(job());
    await processor.idle();
    await flush();
    expect(results).toEqual([
      { jobId: job().jobId, ok: false, error: "La impresora no responde" },
      { jobId: job().jobId, ok: true },
    ]);
    expect(sent).toHaveLength(1);
  });

  it("answers malformed jobs as failed when they have an id", async () => {
    const { processor, results, sent } = setup();
    processor.handle({ jobId: "x1", printerKey: "usb:Cocina", copies: 1, kind: "kitchen", layout: { lines: "nope", cut: true } });
    processor.handle({ nothing: true });
    processor.handle(null);
    await processor.idle();
    expect(results).toEqual([{ jobId: "x1", ok: false, error: INVALID_JOB }]);
    expect(sent).toHaveLength(0);
  });

  it(`remembers the last ${PRINTED_MEMORY} printed jobs`, async () => {
    const { processor, sent } = setup();
    for (let index = 0; index <= PRINTED_MEMORY; index++) processor.handle(job({ jobId: String(index).padStart(24, "0") }));
    await processor.idle();
    await flush();
    processor.handle(job({ jobId: "0".repeat(24) })); // the oldest, forgotten: printed again
    processor.handle(job({ jobId: String(PRINTED_MEMORY).padStart(24, "0") })); // recent: not printed
    await processor.idle();
    expect(sent).toHaveLength(PRINTED_MEMORY + 2);
  });
});

describe("parseJob / errorText", () => {
  it("accepts a well-formed job", () => {
    expect(parseJob(job())).toEqual({ job: job() });
  });

  it("rejects unknown kinds and bad rows", () => {
    expect(parseJob(job({ kind: "other" as never }))).toEqual({ jobId: job().jobId, error: INVALID_JOB });
    expect(parseJob({ ...job(), layout: { columns: 48, cut: true, lines: [{ text: "x", align: "middle", bold: false, size: 1 }] } })).toEqual({
      jobId: job().jobId,
      error: INVALID_JOB,
    });
  });

  it("cuts long errors to the server's limit", () => {
    expect(Array.from(errorText(new Error("é".repeat(400)))).length).toBe(300);
    expect(errorText("")).toBe("La impresora no respondió");
  });
});
