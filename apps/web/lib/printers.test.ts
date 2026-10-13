import type { AgentPrinter, PrintAgentsSummary, PrintAgentView } from "@app/types";
import { describe, expect, it } from "vitest";
import {
  agentStatusLabel,
  canSeePrintJobs,
  categoriesLabel,
  categoriesToSave,
  COPIES_CHOICES,
  jobFailedMessage,
  kitchenPrintTarget,
  mergePrinter,
  newAgents,
  pairingCountdown,
  parseCopies,
  patchPrinter,
  previousValues,
  printBanners,
  queuedMessage,
  relativeTime,
} from "./printers";

const NOW = Date.parse("2026-10-13T15:00:00Z");
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

function printer(key: string, overrides: Partial<AgentPrinter> = {}): AgentPrinter {
  return {
    key,
    name: key,
    kind: "usb",
    reported: true,
    enabled: false,
    paper: "80",
    kitchen: "off",
    categoryIds: [],
    receipts: false,
    copies: 1,
    ...overrides,
  };
}

function agent(id: string, printers: AgentPrinter[] = []): PrintAgentView {
  return { id, name: id, appVersion: "1.0.0", online: false, createdAt: ago(60), lastSeenAt: null, printers };
}

const summary = (overrides: Partial<PrintAgentsSummary> = {}): PrintAgentsSummary => ({
  autoKitchen: false,
  receipts: false,
  online: false,
  offline: false,
  ...overrides,
});

describe("canSeePrintJobs", () => {
  it("allows owners and cashiers only", () => {
    expect(canSeePrintJobs(["owner"])).toBe(true);
    expect(canSeePrintJobs(["cashier"])).toBe(true);
    expect(canSeePrintJobs(["kitchen", "waiter"])).toBe(false);
  });
});

describe("relativeTime / agentStatusLabel", () => {
  it("says how long ago", () => {
    expect(relativeTime(ago(0), NOW)).toBe("hace un momento");
    expect(relativeTime(ago(5), NOW)).toBe("hace 5 min");
    expect(relativeTime(ago(180), NOW)).toBe("hace 3 h");
    expect(relativeTime(ago(60 * 24), NOW)).toBe("hace 1 día");
    expect(relativeTime(ago(60 * 24 * 3), NOW)).toBe("hace 3 días");
    expect(relativeTime(null, NOW)).toBeNull();
    expect(relativeTime(ago(5), 0)).toBeNull();
  });

  it("labels the agent's connection", () => {
    expect(agentStatusLabel({ online: true, lastSeenAt: ago(5) }, NOW)).toBe("En línea");
    expect(agentStatusLabel({ online: false, lastSeenAt: ago(5) }, NOW)).toBe("Desconectado · hace 5 min");
    expect(agentStatusLabel({ online: false, lastSeenAt: null }, NOW)).toBe("Desconectado · nunca se conectó");
    expect(agentStatusLabel({ online: false, lastSeenAt: ago(5) }, 0)).toBe("Desconectado");
  });
});

describe("categories", () => {
  const categories = [
    { id: "a", name: "Bebidas" },
    { id: "b", name: "Postres" },
    { id: "c", name: "Platos" },
  ];

  it("names the filter", () => {
    expect(categoriesLabel([], categories)).toBe("Todas");
    expect(categoriesLabel(["b"], categories)).toBe("Postres");
    expect(categoriesLabel(["a", "b"], categories)).toBe("Bebidas y Postres");
    expect(categoriesLabel(["a", "b", "c"], categories)).toBe("3 categorías");
    expect(categoriesLabel(["gone", "a"], categories)).toBe("Bebidas");
    expect(categoriesLabel(["gone"], categories)).toBe("Ninguna");
  });

  it("saves existing ids in menu order, and every category as no filter", () => {
    expect(categoriesToSave(new Set(["c", "a", "gone"]), categories)).toEqual(["a", "c"]);
    expect(categoriesToSave(new Set(["a", "b", "c"]), categories)).toEqual([]);
    expect(categoriesToSave(new Set(), categories)).toEqual([]);
  });
});

describe("parseCopies", () => {
  it("accepts integers from 1 to 3", () => {
    expect(COPIES_CHOICES).toEqual([1, 2, 3]);
    expect(parseCopies("2")).toBe(2);
    expect(parseCopies(3)).toBe(3);
    expect(parseCopies("0")).toBeNull();
    expect(parseCopies("4")).toBeNull();
    expect(parseCopies("1.5")).toBeNull();
    expect(parseCopies("")).toBeNull();
  });
});

describe("optimistic printer changes", () => {
  it("patches one printer and rolls it back", () => {
    const before = agent("x", [printer("usb:A"), printer("usb:B")]);
    const patched = patchPrinter(before, "usb:A", { enabled: true, copies: 2 });
    expect(patched.printers[0]).toMatchObject({ enabled: true, copies: 2 });
    expect(patched.printers[1]).toBe(before.printers[1]);
    expect(patchPrinter(before, "usb:Z", { enabled: true })).toBe(before);
    expect(previousValues(before.printers[0]!, { enabled: true, copies: 2 })).toEqual({ enabled: false, copies: 1 });
  });

  it("takes the server's copy of the changed printer only", () => {
    const local = agent("x", [printer("usb:A", { enabled: true }), printer("usb:B", { receipts: true })]);
    const server = { ...agent("x", [printer("usb:A", { enabled: true, paper: "58" }), printer("usb:B")]), online: true };
    const merged = mergePrinter(local, server, "usb:A");
    expect(merged.online).toBe(true);
    expect(merged.printers[0]?.paper).toBe("58");
    expect(merged.printers[1]?.receipts).toBe(true);
    // Removed on the server meanwhile.
    expect(mergePrinter(local, agent("x", [printer("usb:B")]), "usb:A").printers.map((p) => p.key)).toEqual(["usb:B"]);
  });
});

describe("pairing", () => {
  it("counts down to the expiry", () => {
    const expiresAt = new Date(NOW + 9 * 60_000 + 42_000).toISOString();
    expect(pairingCountdown(expiresAt, NOW)).toEqual({ secondsLeft: 582, label: "9:42", expired: false });
    expect(pairingCountdown(expiresAt, NOW + 600_000)).toEqual({ secondsLeft: 0, label: "0:00", expired: true });
    expect(pairingCountdown(expiresAt, 0)).toMatchObject({ label: "10:00", expired: false });
  });

  it("finds the computer that was just paired", () => {
    expect(newAgents([agent("a")], [agent("a"), agent("b")]).map((a) => a.id)).toEqual(["b"]);
    expect(newAgents([agent("a")], [agent("a")])).toEqual([]);
  });
});

describe("the board", () => {
  it("prints on the agent when a paired printer is active", () => {
    expect(kitchenPrintTarget(null)).toBe("browser");
    expect(kitchenPrintTarget(summary())).toBe("browser");
    expect(kitchenPrintTarget(summary({ autoKitchen: true, offline: true }))).toBe("agent");
    expect(kitchenPrintTarget(summary({ receipts: true }))).toBe("agent");
    expect(kitchenPrintTarget(summary({ online: true }))).toBe("agent");
    expect(kitchenPrintTarget(summary({ autoKitchen: true }), true)).toBe("browser");
  });

  it("says how many printers took the ticket", () => {
    expect(queuedMessage(1)).toBe("Comanda enviada a 1 impresora");
    expect(queuedMessage(2)).toBe("Comanda enviada a 2 impresoras");
  });

  it("chooses the banners", () => {
    expect(printBanners(null, "new")).toEqual({ agentPrints: false, offline: false, duplicateBrowser: false });
    expect(printBanners(summary({ receipts: true, online: true }), "new")).toEqual({
      agentPrints: false,
      offline: false,
      duplicateBrowser: false,
    });
    expect(printBanners(summary({ autoKitchen: true, online: true }), "off")).toEqual({
      agentPrints: true,
      offline: false,
      duplicateBrowser: false,
    });
    expect(printBanners(summary({ autoKitchen: true, offline: true }), "accepted")).toEqual({
      agentPrints: true,
      offline: true,
      duplicateBrowser: true,
    });
  });

  it("explains a failed job", () => {
    const job = { label: "Comanda #12", printerName: "EPSON", agentName: "Cocina", error: "Sin papel", status: "failed" as const };
    expect(jobFailedMessage(job)).toBe("No se pudo imprimir «Comanda #12» en «EPSON»: Sin papel");
    expect(jobFailedMessage({ ...job, printerName: "", error: null, status: "expired" })).toBe(
      "No se pudo imprimir «Comanda #12» en «Cocina»: venció antes de imprimirse",
    );
  });
});
