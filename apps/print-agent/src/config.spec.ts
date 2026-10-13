import { mkdtempSync, promises as fs, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AgentConfig, ConfigError, agentHome, configPath, deleteConfig, isPaired, loadConfig, saveConfig, validateConfig } from "./config";
import { acquireLock } from "./lock";

const config: AgentConfig = {
  serverUrl: "https://munchmate.example",
  agentId: "65a1b2c3d4e5f60718293a4b",
  token: "secret-token",
  agentName: "Cocina",
  restaurantName: "Trattoria",
  networkPrinters: [{ name: "Barra", host: "192.168.1.60", port: 9100 }],
};

describe("agentHome", () => {
  it("uses %APPDATA% on Windows and ~/.config elsewhere", () => {
    expect(agentHome({ APPDATA: "C:\\Users\\ana\\AppData\\Roaming" }, "win32", "C:\\Users\\ana")).toBe(
      "C:\\Users\\ana\\AppData\\Roaming\\MunchMate\\print-agent",
    );
    expect(agentHome({}, "win32", "C:\\Users\\ana")).toBe("C:\\Users\\ana\\AppData\\Roaming\\MunchMate\\print-agent");
    expect(agentHome({}, "linux", "/home/ana")).toBe("/home/ana/.config/munchmate-print-agent");
    expect(agentHome({ XDG_CONFIG_HOME: "/xdg" }, "darwin", "/Users/ana")).toBe("/xdg/munchmate-print-agent");
    expect(agentHome({ MUNCHMATE_AGENT_HOME: "/tmp/agent" }, "win32", "C:\\")).toBe("/tmp/agent");
  });
});

describe("config file", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mm-agent-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns null when there is no config", async () => {
    await expect(loadConfig(dir)).resolves.toBeNull();
  });

  it("saves atomically and reads it back, leaving no temporary files", async () => {
    await saveConfig(dir, config);
    await saveConfig(dir, { ...config, agentName: "Cocina 2" });
    await expect(loadConfig(dir)).resolves.toEqual({ ...config, agentName: "Cocina 2" });
    expect(readdirSync(dir)).toEqual(["config.json"]);
  });

  it("reads a file saved with a BOM (Notepad)", async () => {
    writeFileSync(configPath(dir), `\ufeff${JSON.stringify(config)}`, "utf8");
    await expect(loadConfig(dir)).resolves.toEqual(config);
  });

  it("refuses a broken file instead of replacing it", async () => {
    writeFileSync(configPath(dir), "{ not json", "utf8");
    await expect(loadConfig(dir)).rejects.toBeInstanceOf(ConfigError);
  });

  it("deletes it", async () => {
    await saveConfig(dir, config);
    await expect(deleteConfig(dir)).resolves.toBe(true);
    await expect(deleteConfig(dir)).resolves.toBe(false);
    await expect(fs.access(configPath(dir))).rejects.toThrow();
  });
});

describe("validateConfig", () => {
  it("normalizes the server URL and printers, and drops unknown fields", () => {
    expect(
      validateConfig({
        ...config,
        serverUrl: "https://MunchMate.example/",
        extra: 1,
        networkPrinters: [{ name: " Barra ", host: "192.168.1.60", port: 9100 }],
      }),
    ).toEqual(config);
  });

  it("treats a missing token as not paired", () => {
    const revoked = validateConfig({ ...config, agentId: null, token: null });
    expect(isPaired(revoked)).toBe(false);
    expect(isPaired(validateConfig(config))).toBe(true);
    expect(isPaired(null)).toBe(false);
  });

  it.each([
    [[]],
    [{ ...config, serverUrl: undefined }],
    [{ ...config, serverUrl: "http://munchmate.example" }],
    [{ ...config, token: 12 }],
    [{ ...config, networkPrinters: {} }],
    [{ ...config, networkPrinters: [{ name: "x", host: "192.168.1.60", port: "9100" }] }],
    [{ ...config, networkPrinters: [{ name: "", host: "192.168.1.60", port: 9100 }] }],
  ])("rejects %p", (raw) => {
    expect(() => validateConfig(raw)).toThrow(ConfigError);
  });

  it("keeps IPv6 printers", () => {
    const parsed = validateConfig({ ...config, networkPrinters: [{ name: "v6", host: "fe80::1", port: 9100 }] });
    expect(parsed.networkPrinters).toEqual([{ name: "v6", host: "fe80::1", port: 9100 }]);
  });
});

describe("acquireLock", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mm-lock-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("allows one instance and frees the lock on release", () => {
    const first = acquireLock(dir, () => true);
    expect(first.ok).toBe(true);
    writeFileSync(join(dir, "agent.lock"), "999999"); // another live agent
    expect(acquireLock(dir, (pid) => pid === 999999)).toEqual({ ok: false, pid: 999999 });
  });

  it("takes over the lock of a process that no longer runs", () => {
    writeFileSync(join(dir, "agent.lock"), "999999");
    const lock = acquireLock(dir, () => false);
    expect(lock.ok).toBe(true);
    if (lock.ok) lock.release();
    expect(readdirSync(dir)).toEqual([]);
  });
});
