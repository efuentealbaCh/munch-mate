import { DeleteObjectsCommand, GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { ApiEnv } from "../../config/env.validation";

/**
 * Object storage on Garage through the S3 API.
 * - Public media bucket: written by the api, read by browsers through MEDIA_PUBLIC_URL (website endpoint).
 * - Private bucket: written by the workers (PDFs), read only by the api for authorized users.
 */
@Injectable()
export class StorageService implements OnApplicationShutdown {
  private readonly client: S3Client;
  private readonly mediaBucket: string;
  private readonly privateBucket: string;
  readonly mediaPublicUrl: string;

  constructor(config: ConfigService<ApiEnv, true>) {
    this.client = new S3Client({
      endpoint: config.get("S3_ENDPOINT", { infer: true }),
      region: config.get("S3_REGION", { infer: true }),
      forcePathStyle: true, // Garage does not use virtual-hosted buckets on the S3 API
      credentials: {
        accessKeyId: config.get("S3_ACCESS_KEY_ID", { infer: true }),
        secretAccessKey: config.get("S3_SECRET_ACCESS_KEY", { infer: true }),
      },
    });
    this.mediaBucket = config.get("S3_MEDIA_BUCKET", { infer: true });
    this.privateBucket = config.get("S3_BUCKET", { infer: true });
    this.mediaPublicUrl = config.get("MEDIA_PUBLIC_URL", { infer: true });
  }

  /**
   * Stores a public, immutable object. Keys are never reused (they contain a random id), so browsers
   * and proxies may cache them forever.
   */
  async putPublic(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.mediaBucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );
  }

  async deletePublic(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    await this.client.send(
      new DeleteObjectsCommand({
        Bucket: this.mediaBucket,
        Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
      }),
    );
  }

  /**
   * Reads an object of the private bucket (e.g. a generated PDF) for the api to stream to an authorized user.
   * @returns null when the object does not exist.
   */
  async getPrivate(key: string): Promise<Buffer | null> {
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.privateBucket, Key: key }));
      return Buffer.from(await result.Body!.transformToByteArray());
    } catch (error) {
      if (error instanceof NoSuchKey) return null;
      throw error;
    }
  }

  /** Browser URL of a public object. */
  publicUrl(key: string): string {
    return `${this.mediaPublicUrl}/${key}`;
  }

  onApplicationShutdown(): void {
    this.client.destroy();
  }
}
