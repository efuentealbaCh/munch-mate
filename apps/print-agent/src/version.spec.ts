import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PRINT_LIMITS } from "@app/types";
import { AGENT_VERSION } from "./version";

describe("AGENT_VERSION", () => {
  it("matches package.json (CI tags the release with it) and fits the server's limit", () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8")) as { version: string };
    expect(AGENT_VERSION).toBe(pkg.version);
    expect(AGENT_VERSION.length).toBeLessThanOrEqual(PRINT_LIMITS.appVersionMax);
  });
});
