import { randomInt } from "node:crypto";
import {
  type AgentHelloInput,
  type AgentHelloResult,
  type AgentPrinter,
  type AgentPrinterSettings,
  DEFAULT_PRINTER_SETTINGS,
  type PairingCodeView,
  type PairPrintAgentInput,
  type PairPrintAgentResult,
  PRINT_LIMITS,
  type PrintAgentsList,
  type PrintAgentsSummary,
  type PrintAgentView,
  type PrintJobView,
} from "@app/types";
import { normalizePairingCode, PAIRING_CODE_ALPHABET } from "@app/utils";
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Redis } from "ioredis";
import { generateToken, hashToken } from "../../common/crypto/tokens";
import { apiError } from "../../common/errors/api-error";
import type { ApiEnv } from "../../config/env.validation";
import { VALKEY } from "../../infra/redis/redis.module";
import { CategoriesRepository } from "../menu/categories.repository";
import { RestaurantsRepository } from "../restaurants/restaurants.repository";
import { PrintAgentPresence } from "./print-agent-presence";
import { type PrintAgentRecord, PrintAgentsRepository } from "./print-agents.repository";
import { PrintAgentsRealtime } from "./print-agents.realtime";
import { PrintJobsService } from "./print-jobs.service";

/** Valkey key of a pending pairing code: only its SHA-256 is stored, with the restaurant as value. */
export const pairingKey = (code: string) => `cache:print-pair:${hashToken(code)}`;

/** `lastSeenAt` is written at most this often (heartbeats arrive every ~25 s). */
export const SEEN_INTERVAL_MS = 60_000;

const agentNotFound = () =>
  new NotFoundException(apiError("PRINT_AGENT_NOT_FOUND", "Ese computador ya no está vinculado"));
const printerNotFound = () =>
  new NotFoundException(apiError("PRINTER_NOT_FOUND", "Ese computador ya no reporta esa impresora"));
const tooManyAgents = () =>
  new ConflictException(
    apiError(
      "TOO_MANY_PRINT_AGENTS",
      `Puedes vincular hasta ${PRINT_LIMITS.agentsPerRestaurant} computadores; desvincula uno que ya no uses`,
      { max: String(PRINT_LIMITS.agentsPerRestaurant) },
    ),
  );

/** A fresh pairing code: `pairingCodeLength` characters of the alphabet, uniformly random. */
export function generatePairingCode(): string {
  let code = "";
  for (let i = 0; i < PRINT_LIMITS.pairingCodeLength; i++) code += PAIRING_CODE_ALPHABET[randomInt(PAIRING_CODE_ALPHABET.length)];
  return code;
}

/**
 * The reported printers with the owner's settings kept per key; printers seen for the first time start with
 * `DEFAULT_PRINTER_SETTINGS` (disabled). Printers the agent no longer reports are kept, settings included, with
 * `reported: false` (a USB printer unplugged when the computer started must not lose its rules), after the
 * reported ones.
 */
export function mergePrinters(current: readonly AgentPrinter[], reported: AgentHelloInput["printers"]): AgentPrinter[] {
  const byKey = new Map(current.map((printer) => [printer.key, printer]));
  const reportedKeys = new Set(reported.map((printer) => printer.key));
  const missing = current.filter((printer) => !reportedKeys.has(printer.key)).map((printer) => ({ ...printer, reported: false }));
  const present = reported.map((printer): AgentPrinter => {
    const known = byKey.get(printer.key);
    const settings: AgentPrinterSettings = known
      ? {
          enabled: known.enabled,
          paper: known.paper,
          kitchen: known.kitchen,
          categoryIds: known.categoryIds,
          receipts: known.receipts,
          copies: known.copies,
        }
      : { ...DEFAULT_PRINTER_SETTINGS, categoryIds: [] };
    return { ...printer, ...settings, reported: true };
  });
  return [...present, ...missing];
}

/**
 * Print agents (phase 8): pairing with a one-time code, the owner's management (names, printer settings,
 * unpairing) and what agents report when they connect. Jobs themselves live in `PrintJobsService`.
 */
@Injectable()
export class PrintAgentsService {
  private readonly downloadUrl: string | null;

  constructor(
    private readonly agents: PrintAgentsRepository,
    private readonly jobs: PrintJobsService,
    private readonly presence: PrintAgentPresence,
    private readonly agentsRealtime: PrintAgentsRealtime,
    private readonly restaurants: RestaurantsRepository,
    private readonly categories: CategoriesRepository,
    @Inject(VALKEY) private readonly valkey: Redis,
    config: ConfigService<ApiEnv, true>,
  ) {
    this.downloadUrl = config.get("PRINT_AGENT_DOWNLOAD_URL", { infer: true }) ?? null;
  }

  // ── Pairing ─────────────────────────────────────────────────────────────

  /**
   * A one-time code the owner types into the agent (valid `pairingCodeMinutes`).
   * @throws ConflictException TOO_MANY_PRINT_AGENTS.
   */
  async createPairingCode(restaurantId: string): Promise<PairingCodeView> {
    if ((await this.agents.countActive(restaurantId)) >= PRINT_LIMITS.agentsPerRestaurant) throw tooManyAgents();
    const code = generatePairingCode();
    const ttl = PRINT_LIMITS.pairingCodeMinutes * 60;
    await this.valkey.set(pairingKey(code), restaurantId, "EX", ttl);
    return { code, expiresAt: new Date(Date.now() + ttl * 1000).toISOString() };
  }

  /**
   * The agent redeems a code (single use: read and deleted in one step) and gets its device token, of which
   * only the hash is kept.
   * @throws BadRequestException INVALID_PAIRING_CODE; ConflictException TOO_MANY_PRINT_AGENTS.
   */
  async pair(input: PairPrintAgentInput): Promise<PairPrintAgentResult> {
    const code = normalizePairingCode(input.code, PRINT_LIMITS.pairingCodeLength);
    const restaurantId = code ? await this.valkey.getdel(pairingKey(code)) : null;
    const restaurant = restaurantId ? await this.restaurants.findById(restaurantId) : null;
    if (!restaurant || restaurant.status !== "active") {
      throw new BadRequestException(
        apiError("INVALID_PAIRING_CODE", "El código no es válido o venció; genera uno nuevo en Impresoras"),
      );
    }
    if ((await this.agents.countActive(restaurant.id)) >= PRINT_LIMITS.agentsPerRestaurant) throw tooManyAgents();
    const token = generateToken();
    const agent = await this.agents.create(restaurant.id, {
      name: input.name,
      tokenHash: hashToken(token),
      appVersion: input.appVersion,
    });
    return { agentId: agent.id, token, restaurantName: restaurant.name };
  }

  // ── Owner ───────────────────────────────────────────────────────────────

  async list(restaurantId: string): Promise<PrintAgentsList> {
    const agents = await this.agents.listActive(restaurantId);
    const online = await this.presence.onlineOf(agents.map((agent) => agent.id));
    return { agents: agents.map((agent) => toAgentView(agent, online.has(agent.id))), downloadUrl: this.downloadUrl };
  }

  /** Whether tickets come out of an agent (any member of the board), so the browser does not print them too. */
  async summary(restaurantId: string): Promise<PrintAgentsSummary> {
    const agents = await this.agents.listActive(restaurantId);
    const usable = (agent: PrintAgentRecord) => agent.printers.filter((printer) => printer.enabled && printer.reported);
    const kitchenAgents = agents.filter((agent) => usable(agent).some((p) => p.kitchen !== "off"));
    const receiptAgents = agents.filter((agent) => usable(agent).some((p) => p.receipts));
    const relevant = [...new Set([...kitchenAgents, ...receiptAgents].map((agent) => agent.id))];
    const online = await this.presence.onlineOf(relevant);
    return {
      autoKitchen: kitchenAgents.length > 0,
      receipts: receiptAgents.length > 0,
      online: online.size > 0,
      offline: kitchenAgents.length > 0 && !kitchenAgents.some((agent) => online.has(agent.id)),
    };
  }

  /** @throws NotFoundException PRINT_AGENT_NOT_FOUND. */
  async rename(restaurantId: string, agentId: string, name: string): Promise<PrintAgentView> {
    const agent = await this.agents.rename(restaurantId, agentId, name);
    if (!agent) throw agentNotFound();
    this.pushConfig(agent);
    return this.view(agent);
  }

  /**
   * Changes the owner's settings of one printer and tells the agent (it needs the paper, for instance).
   * @throws NotFoundException PRINT_AGENT_NOT_FOUND, PRINTER_NOT_FOUND; BadRequestException INVALID_CATEGORY.
   */
  async updatePrinter(
    restaurantId: string,
    agentId: string,
    printerKey: string,
    settings: Partial<AgentPrinterSettings>,
  ): Promise<PrintAgentView> {
    const agent = await this.agents.findActive(restaurantId, agentId);
    if (!agent) throw agentNotFound();
    if (!agent.printers.some((printer) => printer.key === printerKey)) throw printerNotFound();
    if (settings.categoryIds) {
      const own = new Set((await this.categories.list(restaurantId)).map((category) => category.id));
      if (!settings.categoryIds.every((id) => own.has(id))) {
        throw new BadRequestException(apiError("INVALID_CATEGORY", "Una de las categorías no existe en este local"));
      }
      settings = { ...settings, categoryIds: [...new Set(settings.categoryIds)] };
    }
    const updated = await this.agents.updatePrinter(restaurantId, agentId, printerKey, settings);
    // Unpaired, or the agent replaced its printers, between our read and our write.
    if (!updated) throw printerNotFound();
    this.pushConfig(updated);
    return this.view(updated);
  }

  /**
   * Removes a printer that no longer exists (its settings go with it; if the agent reports the key again it
   * comes back disabled with the defaults) and tells the agent. Its pending jobs expire when the agent next
   * says hello.
   * @throws NotFoundException PRINT_AGENT_NOT_FOUND, PRINTER_NOT_FOUND.
   */
  async removePrinter(restaurantId: string, agentId: string, printerKey: string): Promise<PrintAgentView> {
    const agent = await this.agents.findActive(restaurantId, agentId);
    if (!agent) throw agentNotFound();
    const updated = await this.agents.removePrinter(restaurantId, agentId, printerKey);
    if (!updated) throw printerNotFound();
    this.pushConfig(updated);
    return this.view(updated);
  }

  /** @throws NotFoundException PRINT_AGENT_NOT_FOUND, PRINTER_NOT_FOUND. */
  async testPrinter(restaurantId: string, agentId: string, printerKey: string): Promise<PrintJobView | null> {
    const agent = await this.agents.findActive(restaurantId, agentId);
    if (!agent) throw agentNotFound();
    const printer = agent.printers.find((p) => p.key === printerKey);
    if (!printer) throw printerNotFound();
    return this.jobs.testPrinter(restaurantId, agent, printer);
  }

  /**
   * Unpairs an agent: its token stops working, its pending jobs expire, and its open sockets (any replica)
   * get `agent.revoked` and are closed.
   * @throws NotFoundException PRINT_AGENT_NOT_FOUND.
   */
  async revoke(restaurantId: string, agentId: string): Promise<void> {
    const agent = await this.agents.revoke(restaurantId, agentId);
    if (!agent) throw agentNotFound();
    await this.jobs.dropAgent(restaurantId, agent.id);
    this.agentsRealtime.toAgent(agent.id).emit("agent.revoked");
    this.agentsRealtime.disconnect(agent.id);
    await this.presence.clear(agent.id);
  }

  // ── The agent's connection ──────────────────────────────────────────────

  /** The paired agent behind a device token, or null (missing, unknown or revoked). */
  async authenticate(token: unknown): Promise<PrintAgentRecord | null> {
    if (typeof token !== "string" || token.length < 20 || token.length > 200) return null;
    return this.agents.findByTokenHash(hashToken(token));
  }

  /**
   * `agent.hello`: stores the printers it reports (keeping the owner's settings) and its version.
   * @returns The ack, and the updated agent to re-send its pending jobs to.
   */
  async hello(
    agent: Pick<PrintAgentRecord, "id" | "restaurantId">,
    input: AgentHelloInput,
    socketId: string,
  ): Promise<{ ack: AgentHelloResult; agent: PrintAgentRecord | null }> {
    const current = await this.agents.findActive(agent.restaurantId, agent.id);
    if (!current) return { ack: { ok: false, code: "AGENT_REVOKED" }, agent: null };
    const restaurant = await this.restaurants.findById(agent.restaurantId);
    const updated = await this.agents.replacePrinters(
      agent.restaurantId,
      agent.id,
      mergePrinters(current.printers, input.printers),
      input.appVersion,
      new Date(),
    );
    if (!updated) return { ack: { ok: false, code: "AGENT_REVOKED" }, agent: null };
    await this.presence.seen(agent.id, socketId);
    return {
      ack: {
        ok: true,
        agentId: updated.id,
        agentName: updated.name,
        restaurantName: restaurant?.name ?? "",
        printers: updated.printers,
      },
      agent: updated,
    };
  }

  /** A socket of the agent is alive (connection or heartbeat). */
  async seen(agent: Pick<PrintAgentRecord, "id" | "restaurantId">, socketId: string): Promise<void> {
    await this.presence.seen(agent.id, socketId);
    await this.agents.touch(agent.restaurantId, agent.id, new Date(), SEEN_INTERVAL_MS);
  }

  async disconnected(agentId: string, socketId: string): Promise<void> {
    await this.presence.gone(agentId, socketId);
  }

  private pushConfig(agent: PrintAgentRecord): void {
    this.agentsRealtime.toAgent(agent.id).emit("agent.config", { agentName: agent.name, printers: agent.printers });
  }

  private async view(agent: PrintAgentRecord): Promise<PrintAgentView> {
    const online = await this.presence.onlineOf([agent.id]);
    return toAgentView(agent, online.has(agent.id));
  }
}

function toAgentView(agent: PrintAgentRecord, online: boolean): PrintAgentView {
  return {
    id: agent.id,
    name: agent.name,
    appVersion: agent.appVersion,
    online,
    createdAt: agent.createdAt.toISOString(),
    lastSeenAt: agent.lastSeenAt?.toISOString() ?? null,
    printers: agent.printers,
  };
}
