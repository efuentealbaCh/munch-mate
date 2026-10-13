import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Single instance per user: a lock file with the PID of the running agent. Two agents with the same token
 * would print every ticket twice.
 */

export type LockResult = { ok: true; release: () => void } | { ok: false; pid: number };

/** Whether a process with this PID exists (EPERM = it exists but belongs to someone else). */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Takes the lock in `dir`. A lock left by a process that no longer runs (crash, power cut) is taken over.
 * Known limit: if Windows reused that PID for another program, the agent refuses to start until the file
 * `agent.lock` is deleted (or the computer restarted).
 */
export function acquireLock(dir: string, alive: (pid: number) => boolean = isProcessAlive): LockResult {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "agent.lock");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(path, String(process.pid), { flag: "wx" });
      let released = false;
      return {
        ok: true,
        release: () => {
          if (released) return;
          released = true;
          try {
            if (readFileSync(path, "utf8").trim() === String(process.pid)) rmSync(path, { force: true });
          } catch {
            // Already gone.
          }
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let pid = Number.NaN;
      try {
        pid = Number.parseInt(readFileSync(path, "utf8").trim(), 10);
      } catch {
        // Unreadable: treat it as stale.
      }
      if (pid !== process.pid && alive(pid)) return { ok: false, pid };
      rmSync(path, { force: true });
    }
  }
  // Another process took it between our delete and our write.
  const pid = Number.parseInt(readFileSync(path, "utf8").trim(), 10);
  return { ok: false, pid };
}
