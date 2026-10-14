/**
 * Version of the agent, reported to the server (`appVersion`) and used by CI for the release tag
 * (`print-agent-v<version>`). Must match `version` in package.json (checked by version.spec.ts).
 */
export const AGENT_VERSION = "0.1.0";

/** Name of the executable built by `pnpm build:exe`. */
export const EXE_NAME = "munchmate-impresora.exe";
