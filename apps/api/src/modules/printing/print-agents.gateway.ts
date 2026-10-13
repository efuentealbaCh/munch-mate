import {
  type AgentAck,
  type AgentHelloResult,
  PRINT_AGENT_NAMESPACE,
  PRINT_AGENT_UNAUTHORIZED,
  type PrintAgentClientToServerEvents,
  type PrintAgentServerToClientEvents,
} from "@app/types";
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from "@nestjs/websockets";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import type { Socket } from "socket.io";
import { parseHello, parseResult } from "./agent-messages";
import { PrintAgentsService } from "./print-agents.service";
import { type PrintAgentNamespace, PrintAgentsRealtime, printAgentRoom } from "./print-agents.realtime";
import { PrintJobsService } from "./print-jobs.service";

interface AgentSocketData {
  agent: { id: string; restaurantId: string };
  /** Last heartbeat that refreshed presence (ms), to write it at most every HEARTBEAT_WRITE_MS. */
  lastBeat: number;
}

type AgentSocket = Socket<PrintAgentClientToServerEvents, PrintAgentServerToClientEvents, Record<string, never>, AgentSocketData>;

/** Presence is refreshed at most this often from heartbeats (the TTL is 90 s). */
const HEARTBEAT_WRITE_MS = 30_000;

/**
 * The print agents' channel: namespace `/print-agents` on the same Socket.IO server (served at /socket.io).
 * Agents authenticate with their device token in `handshake.auth.token` (no cookies); a missing, unknown or
 * revoked token fails the handshake with `connect_error` "unauthorized".
 *
 * Agents are native programs and send no `Origin` header, which RedisIoAdapter already accepts; browsers
 * always send it, so a foreign web page is still rejected before reaching this namespace (and could not
 * authenticate anyway: the token is not a cookie).
 */
@WebSocketGateway({ namespace: PRINT_AGENT_NAMESPACE })
export class PrintAgentsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  constructor(
    private readonly agents: PrintAgentsService,
    private readonly jobs: PrintJobsService,
    private readonly realtime: PrintAgentsRealtime,
    @InjectPinoLogger(PrintAgentsGateway.name) private readonly logger: PinoLogger,
  ) {}

  afterInit(namespace: PrintAgentNamespace): void {
    this.realtime.attach(namespace);
    // Authenticates during the handshake, so a bad token never gets a connection (connect_error instead).
    namespace.use((socket, next) => {
      this.agents
        .authenticate((socket.handshake.auth as Record<string, unknown> | undefined)?.token)
        .then((agent) => {
          if (!agent) return next(new Error(PRINT_AGENT_UNAUTHORIZED));
          (socket.data as AgentSocketData).agent = { id: agent.id, restaurantId: agent.restaurantId };
          (socket.data as AgentSocketData).lastBeat = 0;
          next();
        })
        .catch((error: unknown) => {
          this.logger.error({ err: error }, "print agent authentication failed");
          next(new Error("unavailable"));
        });
    });
  }

  async handleConnection(socket: AgentSocket): Promise<void> {
    const { agent } = socket.data;
    await socket.join(printAgentRoom(agent.id));
    // Socket.IO's own heartbeat (the client answers every ping with a pong) keeps the agent "online".
    socket.conn.on("packet", (packet: { type: string }) => {
      if (packet.type !== "pong") return;
      const now = Date.now();
      if (now - socket.data.lastBeat < HEARTBEAT_WRITE_MS) return;
      socket.data.lastBeat = now;
      this.agents.seen(agent, socket.id).catch((error: unknown) => this.logger.warn({ err: error, agentId: agent.id }, "print agent heartbeat not stored"));
    });
    try {
      socket.data.lastBeat = Date.now();
      await this.agents.seen(agent, socket.id);
    } catch (error) {
      this.logger.warn({ err: error, agentId: agent.id }, "print agent presence not stored");
    }
  }

  async handleDisconnect(socket: AgentSocket): Promise<void> {
    const agent = socket.data.agent;
    if (!agent) return;
    try {
      await this.agents.disconnected(agent.id, socket.id);
    } catch (error) {
      this.logger.warn({ err: error, agentId: agent.id }, "print agent presence not cleared");
    }
  }

  /** The agent reports its printers; after the ack, its pending jobs are sent again. */
  @SubscribeMessage("agent.hello")
  async hello(@ConnectedSocket() socket: AgentSocket, @MessageBody() payload: unknown): Promise<AgentHelloResult> {
    const input = parseHello(payload);
    if (!input) return { ok: false, code: "INVALID_PAYLOAD" };
    const { ack, agent } = await this.agents.hello(socket.data.agent, input, socket.id);
    if (agent) {
      // After the ack has been written to the socket.
      setImmediate(() => {
        this.jobs.resendPending(agent).catch((error: unknown) => this.logger.warn({ err: error, agentId: agent.id }, "pending print jobs not re-sent"));
      });
    }
    return ack;
  }

  @SubscribeMessage("print.result")
  async result(@ConnectedSocket() socket: AgentSocket, @MessageBody() payload: unknown): Promise<AgentAck> {
    const input = parseResult(payload);
    if (!input) return { ok: false, code: "INVALID_PAYLOAD" };
    return this.jobs.handleResult(
      socket.data.agent,
      input.ok ? { jobId: input.jobId, ok: true } : { jobId: input.jobId, ok: false, error: input.error ?? "La impresora no respondió" },
    );
  }
}
