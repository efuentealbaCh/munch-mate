import { MENU_LIMITS } from "@app/types";
import sharp from "sharp";

/** One output size of a processed image. */
export interface ImageVariant {
  /** Suffix appended to the key: `<base>-<name>.webp`. */
  name: string;
  data: Buffer;
}

export type ImageKind = "product" | "logo";

/** Variant sizes per kind. Products: 4:3 crops for menu cards. Logos: square, letterboxed (never cropped). */
const VARIANTS: Record<ImageKind, { name: string; width: number; height: number; fit: "cover" | "contain" }[]> = {
  product: [
    { name: "sm", width: 160, height: 120, fit: "cover" },
    { name: "md", width: 480, height: 360, fit: "cover" },
    { name: "lg", width: 960, height: 720, fit: "cover" },
  ],
  logo: [
    { name: "sm", width: 96, height: 96, fit: "contain" },
    { name: "md", width: 256, height: 256, fit: "contain" },
  ],
};

export const VARIANT_NAMES: Record<ImageKind, string[]> = {
  product: VARIANTS.product.map((v) => v.name),
  logo: VARIANTS.logo.map((v) => v.name),
};

const ACCEPTED_FORMATS = new Set(["jpeg", "png", "webp", "avif", "gif"]);
/** Rejects decompression bombs before decoding: 40 MP covers any phone camera. */
const MAX_INPUT_PIXELS = 40_000_000;

/** The upload is not an image we accept (wrong format, corrupt, too small). */
export class InvalidImageError extends Error {}

/**
 * Validates an uploaded image and re-encodes it as WebP variants.
 * Re-encoding is the point: it strips EXIF/GPS metadata (sharp drops metadata by default), applies the
 * camera orientation, normalizes size and format, and guarantees the stored file is a real image no
 * matter what the client claimed.
 * @throws InvalidImageError
 */
export async function processImage(input: Buffer, kind: ImageKind): Promise<ImageVariant[]> {
  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  } catch {
    throw new InvalidImageError("El archivo no es una imagen válida");
  }

  if (!metadata.format || !ACCEPTED_FORMATS.has(metadata.format)) {
    throw new InvalidImageError("Formato no soportado. Usa JPG, PNG, WebP o AVIF");
  }
  const width = metadata.autoOrient?.width ?? metadata.width ?? 0;
  const height = metadata.autoOrient?.height ?? metadata.height ?? 0;
  if (Math.min(width, height) < MENU_LIMITS.imageMinSide) {
    throw new InvalidImageError(`La imagen debe medir al menos ${MENU_LIMITS.imageMinSide}×${MENU_LIMITS.imageMinSide} px`);
  }

  try {
    return await Promise.all(
      VARIANTS[kind].map(async (variant) => ({
        name: variant.name,
        data: await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, animated: false })
          .rotate() // apply EXIF orientation before the metadata is dropped
          .resize({
            width: variant.width,
            height: variant.height,
            fit: variant.fit,
            position: sharp.strategy.attention, // crop around the most salient part (the food)
            background: { r: 0, g: 0, b: 0, alpha: 0 },
          })
          .webp({ quality: 80 })
          .toBuffer(),
      })),
    );
  } catch {
    throw new InvalidImageError("No se pudo procesar la imagen");
  }
}
