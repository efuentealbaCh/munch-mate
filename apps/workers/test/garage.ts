// Copy of apps/api/test/support/garage.ts (without the media helpers): test packages do not share code.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";

const GARAGE_IMAGE = "dxflrs/garage:v2.4.1";
const MEDIA_BUCKET = "munchmate-media";
const PRIVATE_BUCKET = "munchmate";
/** Must match `root_domain` of [s3_web] in infra/garage/garage.toml. */
const WEB_ROOT_DOMAIN = ".web.garage.localhost";

export interface StartedGarage {
  container: StartedTestContainer;
  /** Environment the api needs to reach this Garage. */
  env: {
    S3_ENDPOINT: string;
    S3_REGION: string;
    S3_ACCESS_KEY_ID: string;
    S3_SECRET_ACCESS_KEY: string;
    S3_BUCKET: string;
    S3_MEDIA_BUCKET: string;
    MEDIA_PUBLIC_URL: string;
  };
}

/**
 * Starts Garage with the repo's own config (infra/garage/garage.toml) and runs the same setup as
 * infra/scripts/garage-init.sh: layout, app key, public media bucket.
 */
export async function startGarage(): Promise<StartedGarage> {
  const config = readFileSync(join(__dirname, "../../../infra/garage/garage.toml"), "utf8");
  const container = await new GenericContainer(GARAGE_IMAGE)
    .withCopyContentToContainer([{ content: config, target: "/etc/garage.toml" }])
    .withEnvironment({
      GARAGE_RPC_SECRET: randomBytes(32).toString("hex"),
      GARAGE_ADMIN_TOKEN: randomBytes(32).toString("hex"),
      RUST_LOG: "warn",
    })
    .withExposedPorts(3900, 3902)
    // The image has no shell, so port checks that run inside the container fail; probe over HTTP instead
    // (any status means the S3 endpoint is up).
    .withWaitStrategy(Wait.forHttp("/", 3900).forStatusCodeMatching(() => true))
    .start();

  const garage = async (...args: string[]) => {
    const result = await container.exec(["/garage", ...args]);
    if (result.exitCode !== 0) throw new Error(`garage ${args.join(" ")}: ${result.output}`);
    return result.output.trim();
  };

  // The RPC layer may need a moment after the ports open.
  let nodeId = "";
  for (let attempt = 0; attempt < 20 && !nodeId; attempt++) {
    nodeId = await garage("node", "id", "-q").catch(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
      return "";
    });
  }
  await garage("layout", "assign", "-z", "dc1", "-c", "1G", nodeId.slice(0, 16));
  await garage("layout", "apply", "--version", "1");

  const accessKeyId = `GK${randomBytes(12).toString("hex")}`;
  const secretAccessKey = randomBytes(32).toString("hex");
  await garage("key", "import", "--yes", "-n", "test", accessKeyId, secretAccessKey);
  await garage("bucket", "create", PRIVATE_BUCKET);
  await garage("bucket", "allow", "--read", "--write", "--owner", PRIVATE_BUCKET, "--key", accessKeyId);
  await garage("bucket", "create", MEDIA_BUCKET);
  await garage("bucket", "website", "--allow", MEDIA_BUCKET);
  await garage("bucket", "allow", "--read", "--write", "--owner", MEDIA_BUCKET, "--key", accessKeyId);

  return {
    container,
    env: {
      S3_ENDPOINT: `http://${container.getHost()}:${container.getMappedPort(3900)}`,
      S3_REGION: "garage",
      S3_ACCESS_KEY_ID: accessKeyId,
      S3_SECRET_ACCESS_KEY: secretAccessKey,
      S3_BUCKET: PRIVATE_BUCKET,
      S3_MEDIA_BUCKET: MEDIA_BUCKET,
      MEDIA_PUBLIC_URL: `http://${MEDIA_BUCKET}${WEB_ROOT_DOMAIN}:${container.getMappedPort(3902)}`,
    },
  };
}

