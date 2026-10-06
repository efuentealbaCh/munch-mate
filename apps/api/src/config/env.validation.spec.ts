import { envValidationSchema } from "./env.validation";

const validEnv = {
  MONGODB_URI: "mongodb://user:pass@mongo:27017/munchmate?replicaSet=rs0",
  VALKEY_URL: "redis://:pass@valkey:6379",
};

/** Returns the names of the variables that failed validation. */
function invalidKeys(env: Record<string, unknown>): PropertyKey[] {
  const result = envValidationSchema.safeParse(env);
  return result.success ? [] : result.error.issues.map((issue) => issue.path[0] ?? "");
}

describe("envValidationSchema", () => {
  it("applies defaults when only the required variables are present", () => {
    expect(envValidationSchema.parse(validEnv)).toMatchObject({
      NODE_ENV: "development",
      PORT: 3000,
      LOG_LEVEL: "info",
    });
  });

  it("coerces PORT from the string value found in process.env", () => {
    expect(envValidationSchema.parse({ ...validEnv, PORT: "4000" }).PORT).toBe(4000);
  });

  it("reports every missing required variable at once", () => {
    expect(invalidKeys({})).toEqual(expect.arrayContaining(["MONGODB_URI", "VALKEY_URL"]));
  });

  it("rejects connection strings with the wrong scheme", () => {
    expect(invalidKeys({ ...validEnv, VALKEY_URL: "http://valkey:6379" })).toEqual(["VALKEY_URL"]);
    expect(invalidKeys({ ...validEnv, MONGODB_URI: "postgres://db:5432" })).toEqual(["MONGODB_URI"]);
  });

  it("rejects an unknown NODE_ENV", () => {
    expect(invalidKeys({ ...validEnv, NODE_ENV: "staging" })).toEqual(["NODE_ENV"]);
  });
});
