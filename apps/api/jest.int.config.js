/** Integration tests: real MongoDB and Valkey via Testcontainers (Docker must be running). */
module.exports = {
  ...require("./jest.config.js"),
  testRegex: "\\.int-spec\\.ts$",
  testTimeout: 120_000,
};
