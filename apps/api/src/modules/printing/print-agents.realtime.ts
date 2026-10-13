import type { PrintAgentClientToServerEvents, PrintAgentServerToClientEvents } from "@app/types";
import { Injectable } from "@nestjs/common";
import type { Namespace } from "socket.io";

export type PrintAgentNamespace = Namespace<PrintAgentClientToServerEvents, PrintAgentServerToClientEvents>;

/** Room of one agent: every socket it has open (normally one). */
export const printAgentRoom = (agentId: string) => `print-agent:${agentId}`;

/**
 * Emits to print agents from anywhere in the api. The gateway attaches the `/print-agents` namespace once it
 * starts; through the Redis adapter, emissions reach agents connected to any api replica.
 */
@Injectable()
export class PrintAgentsRealtime {
  private namespace?: PrintAgentNamespace;

  attach(namespace: PrintAgentNamespace): void {
    this.namespace = namespace;
  }

  toAgent(agentId: string): {
    emit<E extends keyof PrintAgentServerToClientEvents>(event: E, ...args: Parameters<PrintAgentServerToClientEvents[E]>): void;
  } {
    return {
      emit: (event, ...args) => {
        // Before the gateway starts (unit tests, scripts) emissions are dropped instead of failing.
        this.namespace?.to(printAgentRoom(agentId)).emit(event, ...args);
      },
    };
  }

  /** Closes every socket of the agent, on any replica (it was unpaired). */
  disconnect(agentId: string): void {
    this.namespace?.in(printAgentRoom(agentId)).disconnectSockets(true);
  }
}
