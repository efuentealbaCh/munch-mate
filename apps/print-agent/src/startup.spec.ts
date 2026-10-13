import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExecFile } from "./printers/types";
import {
  LAUNCHER_FILE,
  RUN_KEY,
  RUN_VALUE,
  commandLine,
  installStartup,
  launcherScript,
  regAddArgs,
  regDeleteArgs,
  runValueData,
  selfCommand,
  uninstallStartup,
} from "./startup";

const EXE = "C:\\Users\\José Pérez\\Descargas\\munchmate-impresora.exe";

describe("start with Windows", () => {
  it("runs the .exe itself as a single executable, or node + script in development", () => {
    expect(selfCommand(EXE, EXE, true)).toEqual([EXE]);
    expect(selfCommand("C:\\node\\node.exe", "C:\\repo\\dist\\agent.cjs", false)).toEqual(["C:\\node\\node.exe", "C:\\repo\\dist\\agent.cjs"]);
  });

  it("quotes paths with spaces", () => {
    expect(commandLine([EXE, "--run"])).toBe(`"${EXE}" --run`);
  });

  it("writes a launcher that runs the agent hidden (window style 0) without waiting", () => {
    expect(launcherScript([EXE])).toBe(
      [
        "' Munch Mate - arranca el agente de impresion sin ventana (generado por el agente; se borra con --uninstall-startup).",
        `CreateObject("WScript.Shell").Run """${EXE}"" --run", 0, False`,
        "",
      ].join("\r\n"),
    );
  });

  it("registers wscript + launcher in the user's Run key, or the .exe directly as a fallback", () => {
    const launcher = "C:\\Users\\José Pérez\\AppData\\Roaming\\MunchMate\\print-agent\\iniciar-oculto.vbs";
    const wscript = "C:\\Windows\\System32\\wscript.exe";
    expect(runValueData([EXE], launcher, wscript)).toBe(`${wscript} "${launcher}"`);
    expect(runValueData([EXE], null, wscript)).toBe(`"${EXE}" --run`);
    expect(regAddArgs("x")).toEqual(["add", RUN_KEY, "/v", RUN_VALUE, "/t", "REG_SZ", "/d", "x", "/f"]);
    expect(RUN_KEY).toBe("HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run");
    expect(regDeleteArgs()).toEqual(["delete", RUN_KEY, "/v", RUN_VALUE, "/f"]);
  });

  describe("install / uninstall", () => {
    let home: string;
    beforeEach(() => {
      home = mkdtempSync(join(tmpdir(), "mm-startup-"));
    });
    afterEach(() => rmSync(home, { recursive: true, force: true }));

    it("writes the launcher in UTF-16 with BOM and calls reg.exe by absolute path", async () => {
      const calls: [string, string[]][] = [];
      const exec: ExecFile = async (file, args) => {
        calls.push([file, args]);
        return { stdout: "", stderr: "" };
      };
      const env = { SystemRoot: "C:\\Windows" };
      await expect(installStartup({ home, command: [EXE], env, exec, hasWscript: true })).resolves.toBe("hidden");
      const raw = readFileSync(join(home, LAUNCHER_FILE));
      expect([...raw.subarray(0, 2)]).toEqual([0xff, 0xfe]);
      expect(raw.subarray(2).toString("utf16le")).toBe(launcherScript([EXE]));
      expect(calls[0]?.[0]).toBe("C:\\Windows\\System32\\reg.exe");
      expect(calls[0]?.[1][0]).toBe("add");

      calls.length = 0;
      await expect(uninstallStartup({ home, env, exec })).resolves.toBe(true);
      expect(calls.map(([, args]) => args[0])).toEqual(["query", "delete"]);
      expect(() => readFileSync(join(home, LAUNCHER_FILE))).toThrow();
    });

    it("falls back to the .exe when wscript is missing, and uninstall tolerates a missing value", async () => {
      const calls: string[][] = [];
      const exec: ExecFile = async (_file, args) => {
        calls.push(args);
        if (args[0] === "query") throw Object.assign(new Error("not found"), { code: 1 });
        return { stdout: "", stderr: "" };
      };
      await expect(installStartup({ home, command: [EXE], exec, hasWscript: false })).resolves.toBe("console");
      expect(calls[0]?.[7]).toBe(`"${EXE}" --run`);
      await expect(uninstallStartup({ home, exec })).resolves.toBe(false);
    });
  });
});
