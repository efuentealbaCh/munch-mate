import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { WorkersEnv } from "../config/env.validation";

/** Writes generated files (PDFs) to the private bucket; the api serves them to authorized users. */
@Injectable()
export class PrivateStorageService implements OnApplicationShutdown {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService<WorkersEnv, true>) {
    this.client = new S3Client({
      endpoint: config.get("S3_ENDPOINT", { infer: true }),
      region: config.get("S3_REGION", { infer: true }),
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.get("S3_ACCESS_KEY_ID", { infer: true }),
        secretAccessKey: config.get("S3_SECRET_ACCESS_KEY", { infer: true }),
      },
    });
    this.bucket = config.get("S3_BUCKET", { infer: true });
  }

  /** Overwrites the key if it exists, so a retried job is harmless. */
  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  onApplicationShutdown(): void {
    this.client.destroy();
  }
}
