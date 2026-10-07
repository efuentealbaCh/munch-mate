/** Unit tests: pure logic, no I/O. */
module.exports = {
  rootDir: "src",
  testEnvironment: "node",
  setupFiles: [require("node:path").join(__dirname, "test/support/ipv4-first.js")],
  testRegex: "(?<!int-|e2e-)spec\\.ts$",
  transform: { "^.+\\.ts$": ["ts-jest", { tsconfig: "<rootDir>/../tsconfig.json" }] },
  moduleFileExtensions: ["ts", "js", "json"],
  collectCoverageFrom: ["**/*.service.ts", "**/*.validation.ts"],
  coverageDirectory: "../coverage",
};
