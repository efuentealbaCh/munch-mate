import { main } from "./main";

/** Entry point of the bundle and the .exe. */

// If the event loop ever drains before main() settles (a promise that never resolves), exit with an error, not 0.
process.exitCode = 1;

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`Error inesperado: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  },
);

// Last resort: an unexpected error must not leave a half-working agent (the lock of a dead PID is taken over).
process.on("uncaughtException", (error) => {
  process.stderr.write(`Error inesperado: ${error.message}\n`);
  process.exit(1);
});
