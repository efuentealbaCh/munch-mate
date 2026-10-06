/** Unit tests: pure logic, no I/O. */
module.exports = {
  rootDir: "src",
  testEnvironment: "node",
  testRegex: "(?<!int-|e2e-)spec\\.ts$",
  transform: { "^.+\\.ts$": ["ts-jest", { tsconfig: "<rootDir>/../tsconfig.json" }] },
  moduleFileExtensions: ["ts", "js", "json"],
  collectCoverageFrom: ["**/*.service.ts", "**/*.validation.ts"],
  coverageDirectory: "../coverage",
};
