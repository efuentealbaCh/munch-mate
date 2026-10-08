import type { IncomingMessage } from "node:http";
import type { INestApplicationContext } from "@nestjs/common";
import { IoAdapter } from "@nestjs/platform-socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { Redis } from "ioredis";
import type { Server, ServerOptions } from "socket.io";

/**
 * Socket.IO server backed by Valkey pub/sub, so events emitted by any api replica (or by the workers through
 * @socket.io/redis-emitter) reach every connected client.
 *
 * It also rejects handshakes from foreign origins: browsers send cookies on WebSocket upgrades too, so
 * without this check another site could open an authenticated socket (cross-site WebSocket hijacking).
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly pub: Redis;
  private readonly sub: Redis;

  constructor(
    app: INestApplicationContext,
    valkeyUrl: string,
    private readonly allowedOrigin: string,
  ) {
    super(app);
    this.pub = new Redis(valkeyUrl, { connectionName: "socket-pub" });
    this.sub = this.pub.duplicate({ connectionName: "socket-sub" });
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, {
      ...options,
      allowRequest: (req: IncomingMessage, callback: (err: string | null | undefined, ok: boolean) => void) => {
        const origin = req.headers.origin;
        callback(null, origin === undefined || origin === this.allowedOrigin);
      },
    } as ServerOptions) as Server;
    server.adapter(createAdapter(this.pub, this.sub));
    return server;
  }

  override async close(server: Server): Promise<void> {
    await super.close(server);
    for (const client of [this.pub, this.sub]) {
      // quit() would hang if Valkey is unreachable (see RedisModule).
      if (client.status === "ready") await client.quit();
      else client.disconnect();
    }
  }
}
