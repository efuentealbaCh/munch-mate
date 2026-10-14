const {
  DEFAULT_TIMESTAMP_URL,
  certificateSource,
  newestSdkVersion,
  redactArgs,
  sdkArch,
  signArgs,
  timestampUrl,
  verifyArgs,
} = require("./signing.cjs");

const THUMBPRINT = "0123456789ABCDEF0123456789ABCDEF01234567";

describe("certificateSource", () => {
  it("returns null without variables (the .exe stays unsigned)", () => {
    expect(certificateSource({})).toBeNull();
    expect(certificateSource({ SIGN_PFX_PATH: "  ", SIGN_CERT_SHA1: "" })).toBeNull();
  });

  it("uses the PFX with its password", () => {
    expect(certificateSource({ SIGN_PFX_PATH: "C:\\temp\\cert.pfx", SIGN_PFX_PASSWORD: "s3cret" })).toEqual({
      kind: "pfx",
      path: "C:\\temp\\cert.pfx",
      password: "s3cret",
    });
  });

  it("accepts a PFX without password", () => {
    expect(certificateSource({ SIGN_PFX_PATH: "cert.pfx", SIGN_PFX_PASSWORD: "" })).toEqual({
      kind: "pfx",
      path: "cert.pfx",
      password: undefined,
    });
  });

  it("prefers the PFX over the store thumbprint", () => {
    expect(certificateSource({ SIGN_PFX_PATH: "cert.pfx", SIGN_CERT_SHA1: THUMBPRINT }).kind).toBe("pfx");
  });

  it("normalizes a thumbprint copied from certmgr (spaces, lowercase, invisible marks)", () => {
    const copied = "\u200e01 23 45 67 89 ab cd ef 01 23 45 67 89 ab cd ef 01 23 45 67";
    expect(certificateSource({ SIGN_CERT_SHA1: copied })).toEqual({ kind: "store", sha1: THUMBPRINT });
  });

  it("rejects a thumbprint that is not 40 hex characters", () => {
    expect(() => certificateSource({ SIGN_CERT_SHA1: "1234" })).toThrow("SIGN_CERT_SHA1");
    expect(() => certificateSource({ SIGN_CERT_SHA1: `${THUMBPRINT.slice(0, 39)}Z` })).toThrow("SIGN_CERT_SHA1");
  });
});

describe("timestampUrl", () => {
  it("defaults to DigiCert", () => {
    expect(timestampUrl({})).toBe(DEFAULT_TIMESTAMP_URL);
    expect(timestampUrl({ SIGN_TIMESTAMP_URL: " " })).toBe(DEFAULT_TIMESTAMP_URL);
  });

  it("takes SIGN_TIMESTAMP_URL", () => {
    expect(timestampUrl({ SIGN_TIMESTAMP_URL: "http://ts.ssl.com" })).toBe("http://ts.ssl.com");
  });

  it("rejects anything that is not an http(s) URL", () => {
    expect(() => timestampUrl({ SIGN_TIMESTAMP_URL: "timestamp.digicert.com" })).toThrow("SIGN_TIMESTAMP_URL");
    expect(() => timestampUrl({ SIGN_TIMESTAMP_URL: "file:///C:/ts" })).toThrow("http o https");
  });
});

describe("signArgs", () => {
  const common = [
    "sign",
    "/fd",
    "sha256",
    "/tr",
    "http://ts.example",
    "/td",
    "sha256",
    "/d",
    "Munch Mate Impresora",
    "/du",
    "https://github.com/efuentealbaCh/munch-mate",
  ];

  it("signs with a PFX and its password, file last", () => {
    const args = signArgs({
      source: { kind: "pfx", path: "C:\\t\\c.pfx", password: "p w" },
      file: "dist\\munchmate-impresora.exe",
      timestampUrl: "http://ts.example",
    });
    expect(args).toEqual([...common, "/f", "C:\\t\\c.pfx", "/p", "p w", "dist\\munchmate-impresora.exe"]);
  });

  it("omits /p for a PFX without password", () => {
    const args = signArgs({ source: { kind: "pfx", path: "c.pfx", password: undefined }, file: "a.exe", timestampUrl: "http://ts.example" });
    expect(args).toEqual([...common, "/f", "c.pfx", "a.exe"]);
  });

  it("selects a store certificate by thumbprint", () => {
    const args = signArgs({ source: { kind: "store", sha1: THUMBPRINT }, file: "a.exe", timestampUrl: "http://ts.example" });
    expect(args).toEqual([...common, "/sha1", THUMBPRINT, "a.exe"]);
  });
});

describe("verifyArgs", () => {
  it("verifies with the default Authenticode policy", () => {
    expect(verifyArgs("a.exe")).toEqual(["verify", "/pa", "/v", "a.exe"]);
  });
});

describe("redactArgs", () => {
  it("masks the PFX password and nothing else", () => {
    const args = signArgs({ source: { kind: "pfx", path: "c.pfx", password: "hunter2" }, file: "a.exe", timestampUrl: "http://ts.example" });
    const redacted = redactArgs(args);
    expect(redacted).not.toContain("hunter2");
    expect(redacted[redacted.indexOf("/p") + 1]).toBe("***");
    expect(redacted.filter((arg) => arg === "***")).toHaveLength(1);
    expect(redacted).toContain("c.pfx");
  });

  it("does not mask a value that only looks like /p elsewhere", () => {
    expect(redactArgs(["/p"])).toEqual(["/p"]);
    expect(redactArgs(["verify", "/pa", "/v", "a.exe"])).toEqual(["verify", "/pa", "/v", "a.exe"]);
  });
});

describe("newestSdkVersion", () => {
  it("compares versions numerically and ignores other folders", () => {
    expect(newestSdkVersion(["10.0.22621.0", "10.0.26100.0", "10.0.9200.0", "x64", "arm64"])).toBe("10.0.26100.0");
    expect(newestSdkVersion(["10.0.19041.0", "10.0.19041.1"])).toBe("10.0.19041.1");
  });

  it("returns null without SDK folders", () => {
    expect(newestSdkVersion([])).toBeNull();
    expect(newestSdkVersion(["x86", "x64"])).toBeNull();
  });
});

describe("sdkArch", () => {
  it("maps Node architectures to SDK folders", () => {
    expect(sdkArch("x64")).toBe("x64");
    expect(sdkArch("arm64")).toBe("arm64");
    expect(sdkArch("ia32")).toBe("x86");
  });
});
