/** Unit tests for the shared helpers (plain TypeScript, no I/O). */
module.exports = {
  rootDir: "src",
  testEnvironment: "node",
  transform: { "^.+\\.ts$": ["ts-jest", { tsconfig: "<rootDir>/../tsconfig.json" }] },
};
