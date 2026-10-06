import type { Job } from "bullmq";
import { SystemProcessor } from "./system.processor";

/** Builds the minimal job shape the processor reads. */
function fakeJob(name: string): Job {
  return { name, data: { sentAt: new Date().toISOString() } } as Job;
}

describe("SystemProcessor", () => {
  const processor = new SystemProcessor();

  it("answers ping jobs with pong", async () => {
    await expect(processor.process(fakeJob("ping"))).resolves.toMatchObject({ pong: true });
  });

  it("fails unknown jobs so they land in the failed set", async () => {
    await expect(processor.process(fakeJob("does-not-exist"))).rejects.toThrow('Unknown job "does-not-exist"');
  });
});
