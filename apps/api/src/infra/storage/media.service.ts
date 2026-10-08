import { randomBytes } from "node:crypto";
import type { LogoImage, ProductImage } from "@app/types";
import { Injectable, UnprocessableEntityException } from "@nestjs/common";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import { apiError } from "../../common/errors/api-error";
import { type ImageKind, InvalidImageError, processImage, VARIANT_NAMES } from "./image-processor";
import { StorageService } from "./storage.service";

/**
 * Stores processed images in the public media bucket and builds their URLs.
 * The database only keeps the base key (`<prefix>/<random id>`); variants are `<base>-<size>.webp`.
 */
@Injectable()
export class MediaService {
  constructor(
    private readonly storage: StorageService,
    @InjectPinoLogger(MediaService.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Processes and uploads an image.
   * @param keyPrefix Tenant-scoped folder, e.g. `restaurants/<id>/products/<productId>`.
   * @returns The base key to store in the document.
   * @throws UnprocessableEntityException INVALID_IMAGE.
   */
  async storeImage(kind: ImageKind, keyPrefix: string, input: Buffer): Promise<string> {
    let variants;
    try {
      variants = await processImage(input, kind);
    } catch (error) {
      if (error instanceof InvalidImageError) {
        throw new UnprocessableEntityException(apiError("INVALID_IMAGE", error.message));
      }
      throw error;
    }

    // A new random id per upload: URLs never change content, so they can be cached forever.
    const base = `${keyPrefix}/${randomBytes(9).toString("base64url")}`;
    await Promise.all(
      variants.map((variant) => this.storage.putPublic(`${base}-${variant.name}.webp`, variant.data, "image/webp")),
    );
    return base;
  }

  /**
   * Deletes every variant of an image. Best effort: a failure leaves an orphan file in storage,
   * which is preferable to failing the user's action after the database already changed.
   */
  async deleteImage(kind: ImageKind, base: string | null): Promise<void> {
    if (!base) return;
    try {
      await this.storage.deletePublic(VARIANT_NAMES[kind].map((name) => `${base}-${name}.webp`));
    } catch (error) {
      this.logger.warn({ err: error, base }, "could not delete image variants");
    }
  }

  productImage(base: string | null): ProductImage | null {
    if (!base) return null;
    return { sm: this.url(base, "sm"), md: this.url(base, "md"), lg: this.url(base, "lg") };
  }

  logoImage(base: string | null): LogoImage | null {
    if (!base) return null;
    return { sm: this.url(base, "sm"), md: this.url(base, "md") };
  }

  private url(base: string, variant: string): string {
    return this.storage.publicUrl(`${base}-${variant}.webp`);
  }
}
