/**
 * Unit tests: pure logic plus the Socket.IO client against an in-memory server (no Docker, no printers).
 * scripts/*.spec.cjs cover the pure helpers of the .exe build and signing scripts (plain CommonJS, no transform).
 */
module.exports = {
  rootDir: "src",
  roots: ["<rootDir>", "<rootDir>/../scripts"],
  testEnvironment: "node",
  testMatch: ["**/*.spec.ts", "**/*.spec.cjs"],
  transform: { "^.+\.ts$": ["ts-jest", { tsconfig: "<rootDir>/../tsconfig.json" }] },
  moduleFileExtensions: ["ts", "js", "cjs", "json"],
};
