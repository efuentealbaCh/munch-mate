/** Unit tests: pure logic plus the Socket.IO client against an in-memory server (no Docker, no printers). */
module.exports = {
  rootDir: "src",
  testEnvironment: "node",
  transform: { "^.+\.ts$": ["ts-jest", { tsconfig: "<rootDir>/../tsconfig.json" }] },
  moduleFileExtensions: ["ts", "js", "json"],
};
