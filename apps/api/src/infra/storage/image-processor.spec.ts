import sharp from "sharp";
import { InvalidImageError, processImage } from "./image-processor";

/** A JPEG with EXIF data (camera model, GPS) and a 90° orientation flag, like a phone photo. */
async function phonePhoto(width = 1200, height = 900): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: "#c2410c" } })
    .jpeg()
    .withExif({ IFD0: { Make: "PhoneMaker", Model: "Phone 15" }, IFD3: { GPSLatitude: "33/1 26/1 0/1" } })
    .withMetadata({ orientation: 6 })
    .toBuffer();
}

describe("processImage", () => {
  it("produces 4:3 WebP variants for products", async () => {
    const variants = await processImage(await phonePhoto(), "product");

    const sizes = await Promise.all(variants.map(async (v) => [v.name, await sharp(v.data).metadata()] as const));
    expect(sizes.map(([name, m]) => [name, m.format, m.width, m.height])).toEqual([
      ["sm", "webp", 160, 120],
      ["md", "webp", 480, 360],
      ["lg", "webp", 960, 720],
    ]);
  });

  it("strips EXIF/GPS metadata and the orientation flag", async () => {
    const source = await phonePhoto();
    expect((await sharp(source).metadata()).exif).toBeDefined();

    const [variant] = await processImage(source, "product");
    const metadata = await sharp(variant!.data).metadata();

    expect(metadata.exif).toBeUndefined();
    expect(metadata.orientation).toBeUndefined();
  });

  it("produces square logos without cropping", async () => {
    const variants = await processImage(await phonePhoto(1000, 300), "logo");

    const md = await sharp(variants.find((v) => v.name === "md")!.data).metadata();
    expect([md.width, md.height, md.hasAlpha]).toEqual([256, 256, true]); // letterboxed with transparency
  });

  it("rejects files that are not images", async () => {
    await expect(processImage(Buffer.from("<svg onload=alert(1)>"), "product")).rejects.toThrow(InvalidImageError);
    await expect(processImage(Buffer.from("%PDF-1.7 fake"), "product")).rejects.toThrow(InvalidImageError);
  });

  it("rejects images that are too small", async () => {
    const tiny = await sharp({ create: { width: 150, height: 150, channels: 3, background: "#000" } }).png().toBuffer();

    await expect(processImage(tiny, "product")).rejects.toThrow(/al menos 200/);
  });
});
