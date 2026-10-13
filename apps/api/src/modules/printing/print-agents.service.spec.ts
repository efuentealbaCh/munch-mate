import { DEFAULT_PRINTER_SETTINGS, PRINT_LIMITS } from "@app/types";
import { PAIRING_CODE_ALPHABET } from "@app/utils";
import type { ConfigService } from "@nestjs/config";
import type { Redis } from "ioredis";
import { hashToken } from "../../common/crypto/tokens";
import type { ApiEnv } from "../../config/env.validation";
import type { CategoriesRepository } from "../menu/categories.repository";
import type { RestaurantsRepository } from "../restaurants/restaurants.repository";
import type { PrintAgentPresence } from "./print-agent-presence";
import type { PrintAgentRecord, PrintAgentsRepository } from "./print-agents.repository";
import type { PrintAgentsRealtime } from "./print-agents.realtime";
import { generatePairingCode, mergePrinters, pairingKey, PrintAgentsService } from "./print-agents.service";
import type { PrintJobsService } from "./print-jobs.service";

const agentRecord = (over: Partial<PrintAgentRecord> = {}): PrintAgentRecord => ({
  id: "a1",
  restaurantId: "r1",
  name: "Cocina",
  appVersion: "1.0.0",
  createdAt: new Date(),
  lastSeenAt: null,
  revokedAt: null,
  printers: [],
  ...over,
});

/** A Valkey stand-in with expiry, enough for SET EX / GETDEL. */
function fakeValkey() {
  const data = new Map<string, { value: string; expiresAt: number }>();
  return {
    data,
    set: jest.fn(async (key: string, value: string, _ex: string, seconds: number) => {
      data.set(key, { value, expiresAt: Date.now() + seconds * 1000 });
      return "OK";
    }),
    getdel: jest.fn(async (key: string) => {
      const entry = data.get(key);
      data.delete(key);
      return entry && entry.expiresAt > Date.now() ? entry.value : null;
    }),
  };
}

function setup(options: { activeAgents?: number; restaurantStatus?: string; agents?: PrintAgentRecord[]; online?: string[] } = {}) {
  const valkey = fakeValkey();
  const agents = {
    countActive: jest.fn(async () => options.activeAgents ?? 0),
    create: jest.fn(async (_r: string, input: { name: string; tokenHash: string }) => agentRecord({ name: input.name })),
    findActive: jest.fn(async (_r: string, id: string) => (options.agents ?? [agentRecord()]).find((a) => a.id === id) ?? null),
    findByTokenHash: jest.fn(async () => agentRecord()),
    updatePrinter: jest.fn(async () => agentRecord()),
    revoke: jest.fn(async () => agentRecord()),
    listActive: jest.fn(async () => options.agents ?? [agentRecord()]),
    removePrinter: jest.fn(async (_r: string, id: string, key: string) => {
      const found = (options.agents ?? []).find((a) => a.id === id);
      return found?.printers.some((p) => p.key === key) ? { ...found, printers: found.printers.filter((p) => p.key !== key) } : null;
    }),
    replacePrinters: jest.fn(async (_r: string, _a: string, printers: PrintAgentRecord["printers"]) => agentRecord({ printers })),
  };
  const jobs = { dropAgent: jest.fn(async () => undefined) };
  const emitted: string[] = [];
  const realtime = {
    toAgent: () => ({ emit: (event: string) => emitted.push(event) }),
    disconnect: jest.fn(),
  };
  const presence = {
    onlineOf: jest.fn(async (ids: readonly string[]) => new Set(ids.filter((id) => options.online?.includes(id)))), seen: jest.fn(async () => undefined), clear: jest.fn(async () => undefined) };
  const service = new PrintAgentsService(
    agents as unknown as PrintAgentsRepository,
    jobs as unknown as PrintJobsService,
    presence as unknown as PrintAgentPresence,
    realtime as unknown as PrintAgentsRealtime,
    { findById: jest.fn(async (id: string) => ({ id, name: "Forno Rosso", status: options.restaurantStatus ?? "active" })) } as unknown as RestaurantsRepository,
    { list: jest.fn(async () => [{ id: "c".repeat(24) }]) } as unknown as CategoriesRepository,
    valkey as unknown as Redis,
    { get: () => "https://descargas.test/agente.exe" } as unknown as ConfigService<ApiEnv, true>,
  );
  return { service, valkey, agents, jobs, emitted, realtime, presence };
}

describe("PrintAgentsService pairing", () => {
  it("generates codes of the right length from the unambiguous alphabet", () => {
    for (let i = 0; i < 50; i++) {
      const code = generatePairingCode();
      expect(code).toHaveLength(PRINT_LIMITS.pairingCodeLength);
      expect([...code].every((c) => PAIRING_CODE_ALPHABET.includes(c))).toBe(true);
    }
  });

  it("stores only the code's hash, for 10 minutes", async () => {
    const { service, valkey } = setup();
    const { code, expiresAt } = await service.createPairingCode("r1");
    expect(valkey.set).toHaveBeenCalledWith(`cache:print-pair:${hashToken(code)}`, "r1", "EX", 600);
    expect([...valkey.data.keys()].some((key) => key.includes(code))).toBe(false);
    expect(new Date(expiresAt).getTime() - Date.now()).toBeGreaterThan(9 * 60_000);
  });

  it("pairs once with a code (typed loosely) and keeps only the token's hash", async () => {
    const { service, agents } = setup();
    const { code } = await service.createPairingCode("r1");
    const typed = `${code.slice(0, 4).toLowerCase()}-${code.slice(4)}`;

    const result = await service.pair({ code: typed, name: "Cocina", appVersion: "1.0.0" });

    expect(result).toMatchObject({ agentId: "a1", restaurantName: "Forno Rosso" });
    expect(result.token.length).toBeGreaterThanOrEqual(43);
    expect(agents.create).toHaveBeenCalledWith("r1", { name: "Cocina", tokenHash: hashToken(result.token), appVersion: "1.0.0" });
    // Single use.
    await expect(service.pair({ code, name: "Otra", appVersion: "1.0.0" })).rejects.toMatchObject({
      response: { code: "INVALID_PAIRING_CODE" },
    });
  });

  it("rejects expired, unknown and malformed codes alike", async () => {
    const { service, valkey } = setup();
    const { code } = await service.createPairingCode("r1");
    valkey.data.get(pairingKey(code))!.expiresAt = Date.now() - 1;
    for (const attempt of [code, "ZZZZZZZZ", "abc"]) {
      await expect(service.pair({ code: attempt, name: "Cocina", appVersion: "1" })).rejects.toMatchObject({
        response: { code: "INVALID_PAIRING_CODE" },
      });
    }
  });

  it("refuses a code of a suspended restaurant and limits the agents per restaurant", async () => {
    const suspended = setup({ restaurantStatus: "suspended" });
    const { code } = await suspended.service.createPairingCode("r1");
    await expect(suspended.service.pair({ code, name: "C", appVersion: "1" })).rejects.toMatchObject({
      response: { code: "INVALID_PAIRING_CODE" },
    });
    const full = setup({ activeAgents: PRINT_LIMITS.agentsPerRestaurant });
    await expect(full.service.createPairingCode("r1")).rejects.toMatchObject({ response: { code: "TOO_MANY_PRINT_AGENTS" } });
  });
});

describe("PrintAgentsService agents", () => {
  it("keeps the owner's settings of printers the agent reports again, and starts new ones disabled", () => {
    const configured = { key: "usb:A", name: "A", kind: "usb" as const, ...DEFAULT_PRINTER_SETTINGS, enabled: true, kitchen: "new" as const, copies: 2, reported: true };
    const merged = mergePrinters([configured], [
      { key: "usb:A", name: "A renombrada", kind: "usb" },
      { key: "net:10.0.0.5:9100", name: "Barra", kind: "network" },
    ]);
    expect(merged).toEqual([
      { ...configured, name: "A renombrada" },
      { key: "net:10.0.0.5:9100", name: "Barra", kind: "network", ...DEFAULT_PRINTER_SETTINGS, reported: true },
    ]);
  });

  it("keeps printers the agent stops reporting, with their settings, and restores them when they come back", () => {
    const kitchen = { key: "usb:A", name: "A", kind: "usb" as const, ...DEFAULT_PRINTER_SETTINGS, enabled: true, kitchen: "new" as const, categoryIds: ["c1"], paper: "58" as const, reported: true };
    const unplugged = mergePrinters([kitchen], [{ key: "net:10.0.0.5:9100", name: "Barra", kind: "network" }]);
    expect(unplugged).toEqual([
      { key: "net:10.0.0.5:9100", name: "Barra", kind: "network", ...DEFAULT_PRINTER_SETTINGS, reported: true },
      { ...kitchen, reported: false },
    ]);
    const back = mergePrinters(unplugged, [{ key: "usb:A", name: "A", kind: "usb" }, { key: "net:10.0.0.5:9100", name: "Barra", kind: "network" }]);
    expect(back[0]).toEqual(kitchen);
  });

  it("answers hello with the stored printers and refuses a revoked agent", async () => {
    const { service, presence } = setup();
    const { ack } = await service.hello({ id: "a1", restaurantId: "r1" }, { appVersion: "1.1.0", printers: [{ key: "usb:A", name: "A", kind: "usb" }] }, "sock1");
    expect(ack).toMatchObject({ ok: true, agentId: "a1", restaurantName: "Forno Rosso", printers: [{ key: "usb:A", enabled: false }] });
    expect(presence.seen).toHaveBeenCalledWith("a1", "sock1");
    const revoked = setup({ agents: [] });
    await expect(revoked.service.hello({ id: "a1", restaurantId: "r1" }, { appVersion: "1", printers: [] }, "s")).resolves.toMatchObject({
      ack: { ok: false, code: "AGENT_REVOKED" },
    });
  });

  it("checks that printer categories belong to the restaurant and tells the agent its new settings", async () => {
    const withPrinter = [agentRecord({ printers: [{ key: "usb:A", name: "A", kind: "usb", ...DEFAULT_PRINTER_SETTINGS, reported: true }] })];
    const { service, agents, emitted } = setup({ agents: withPrinter });
    await expect(service.updatePrinter("r1", "a1", "usb:A", { categoryIds: ["d".repeat(24)] })).rejects.toMatchObject({
      response: { code: "INVALID_CATEGORY" },
    });
    await service.updatePrinter("r1", "a1", "usb:A", { enabled: true, categoryIds: ["c".repeat(24), "c".repeat(24)] });
    expect(agents.updatePrinter).toHaveBeenCalledWith("r1", "a1", "usb:A", { enabled: true, categoryIds: ["c".repeat(24)] });
    expect(emitted).toEqual(["agent.config"]);
    await expect(service.updatePrinter("r1", "a1", "usb:nope", { enabled: true })).rejects.toMatchObject({
      response: { code: "PRINTER_NOT_FOUND" },
    });
  });

  it("revokes: drops its jobs, tells and disconnects the agent", async () => {
    const { service, jobs, emitted, realtime, presence } = setup();
    await service.revoke("r1", "a1");
    expect(jobs.dropAgent).toHaveBeenCalledWith("r1", "a1");
    expect(emitted).toEqual(["agent.revoked"]);
    expect(realtime.disconnect).toHaveBeenCalledWith("a1");
    expect(presence.clear).toHaveBeenCalledWith("a1");
  });

  it("authenticates by token hash, ignoring obviously bad tokens", async () => {
    const { service, agents } = setup();
    await expect(service.authenticate(undefined)).resolves.toBeNull();
    await expect(service.authenticate("short")).resolves.toBeNull();
    await service.authenticate("x".repeat(43));
    expect(agents.findByTokenHash).toHaveBeenCalledWith(hashToken("x".repeat(43)));
  });
});

describe("PrintAgentsService printers and summary", () => {
  const p = (over: object) => ({ key: "usb:A", name: "A", kind: "usb" as const, ...DEFAULT_PRINTER_SETTINGS, reported: true, ...over });

  it("lets the owner remove a printer and tells the agent", async () => {
    const agents = [agentRecord({ printers: [p({ key: "usb:A" }), p({ key: "usb:B" })] })];
    const { service, emitted } = setup({ agents });
    const view = await service.removePrinter("r1", "a1", "usb:A");
    expect(view.printers.map((printer) => printer.key)).toEqual(["usb:B"]);
    expect(emitted).toEqual(["agent.config"]);
    await expect(service.removePrinter("r1", "a1", "usb:nope")).rejects.toMatchObject({ response: { code: "PRINTER_NOT_FOUND" } });
    await expect(service.removePrinter("r1", "zz", "usb:B")).rejects.toMatchObject({ response: { code: "PRINT_AGENT_NOT_FOUND" } });
  });

  it("counts enabled and reported printers, and warns when no kitchen agent is connected", async () => {
    const kitchen = agentRecord({ id: "a1", printers: [p({ enabled: true, kitchen: "new" })] });
    const cashier = agentRecord({ id: "a2", printers: [p({ enabled: true, receipts: true })] });
    const unplugged = agentRecord({ id: "a3", printers: [p({ enabled: true, kitchen: "new", reported: false })] });

    expect(await setup({ agents: [kitchen, cashier], online: ["a1"] }).service.summary("r1")).toEqual({
      autoKitchen: true,
      receipts: true,
      online: true,
      offline: false,
    });
    // The kitchen agent is offline for a moment: tickets still go to it (queued), and the web warns.
    expect(await setup({ agents: [kitchen, cashier], online: ["a2"] }).service.summary("r1")).toEqual({
      autoKitchen: true,
      receipts: true,
      online: true,
      offline: true,
    });
    // A printer the agent does not report does not count.
    expect(await setup({ agents: [unplugged], online: ["a3"] }).service.summary("r1")).toEqual({
      autoKitchen: false,
      receipts: false,
      online: false,
      offline: false,
    });
  });
});
