import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WorkerHost } from "@nestjs/bullmq";
import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DiscoveryService } from "@nestjs/core";
import { InjectConnection } from "@nestjs/mongoose";
import { Redis } from "ioredis";
import type { Connection } from "mongoose";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import type { WorkersEnv } from "../config/env.validation";

const CHECK_TIMEOUT_MS = 1500;

export interface WorkersHealth {
  status: "ok" | "error";
  mongo: "up" | "down";
  valkey: "up" | "down";
  /** Queue name → whether its BullMQ worker is consuming jobs. */
  queues: Record<string, "running" | "stopped">;
}

/**
 * Minimal HTTP server exposing `GET /health` for the Docker healthcheck.
 * The workers have no other HTTP surface, and this port is never published outside the container.
 */
@Injectable()
export class HealthServer implements OnApplicationBootstrap, OnApplicationShutdown {
  private server?: Server;
  /** Dedicated connection: BullMQ 6 no longer exposes its worker clients publicly. */
  private valkey?: Redis;

  constructor(
    private readonly config: ConfigService<WorkersEnv, true>,
    private readonly discovery: DiscoveryService,
    @InjectConnection() private readonly mongo: Connection,
    @InjectPinoLogger(HealthServer.name) private readonly logger: PinoLogger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.valkey = new Redis(this.config.get("VALKEY_URL", { infer: true }), {
      connectionName: "workers-health",
      maxRetriesPerRequest: 1,
    });

    this.server = createServer((req, res) => {
      if (req.method !== "GET" || req.url !== "/health") {
        res.writeHead(404).end();
        return;
      }
      this.check()
        .then((health) => {
          res.writeHead(health.status === "ok" ? 200 : 503, { "content-type": "application/json" });
          res.end(JSON.stringify(health));
        })
        .catch((error: unknown) => {
          this.logger.error({ err: error }, "health check crashed");
          res.writeHead(500).end();
        });
    });

    const port = this.config.get("HEALTH_PORT", { infer: true });
    await new Promise<void>((resolve) => this.server?.listen(port, "0.0.0.0", resolve));
    this.logger.info({ port: this.port }, "health server listening");
  }

  async onApplicationShutdown(): Promise<void> {
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
    // disconnect() instead of quit(): quit() would wait forever if Valkey is already unreachable.
    this.valkey?.disconnect();
  }

  /** Port actually bound (differs from HEALTH_PORT when it is 0). */
  get port(): number {
    return (this.server?.address() as AddressInfo | null)?.port ?? 0;
  }

  /** Evaluates MongoDB, Valkey and every registered BullMQ worker. */
  async check(): Promise<WorkersHealth> {
    const workers = this.workerHosts().map((host) => host.worker);

    const queues = Object.fromEntries(
      workers.map((worker) => [worker.name, worker.isRunning() ? "running" : "stopped"] as const),
    );
    const mongo = this.mongo.readyState === 1 ? "up" : "down";
    const valkey = await this.pingValkey();

    const healthy = mongo === "up" && valkey === "up" && Object.values(queues).every((q) => q === "running");
    return { status: healthy ? "ok" : "error", mongo, valkey, queues };
  }

  /** All providers extending WorkerHost (i.e. every `@Processor`), discovered at runtime. */
  private workerHosts(): WorkerHost[] {
    return this.discovery
      .getProviders()
      .map((wrapper) => wrapper.instance as unknown)
      .filter((instance): instance is WorkerHost => instance instanceof WorkerHost);
  }

  private async pingValkey(): Promise<"up" | "down"> {
    const client = this.valkey;
    if (!client) return "down";
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("valkey ping timed out")), CHECK_TIMEOUT_MS);
      });
      await Promise.race([client.ping(), timeout]);
      return "up";
    } catch {
      return "down";
    } finally {
      clearTimeout(timer);
    }
  }
}
