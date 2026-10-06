/** API end-to-end tests: full Nest app over HTTP against Testcontainers. */
module.exports = {
  ...require("./jest.config.js"),
  rootDir: ".",
  roots: ["<rootDir>/test"],
  testRegex: "\\.e2e-spec\\.ts$",
  transform: { "^.+\\.ts$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.json" }] },
  testTimeout: 120_000,
};
