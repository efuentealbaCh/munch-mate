import type { StorageService } from "../../infra/storage/storage.service";
import { isMapPath, MapsService } from "./maps.service";

describe("isMapPath", () => {
  it.each([
    [["chile.pmtiles"]],
    [["fonts", "Noto Sans Regular", "0-255.pbf"]],
    [["sprites", "v4", "light@2x.png"]],
  ])("serves %j", (path) => {
    expect(isMapPath(path)).toBe(true);
  });

  it.each([
    [[]],
    [[".."]],
    [["fonts", "..", "secret"]],
    [["restaurants", "r1", "receipts", "o1.pdf"]],
    [["chile.pmtiles", "x"]],
    [["fonts", "a/b"]],
    [["fonts", "a", "b", "c", "d"]],
  ])("refuses %j", (path) => {
    expect(isMapPath(path)).toBe(false);
  });
});

describe("MapsService", () => {
  it("reports the map as unavailable until the archive is uploaded, and caches the answer", async () => {
    const storage = { existsPrivate: jest.fn(async () => false), getPrivateStream: jest.fn() };
    const service = new MapsService(storage as unknown as StorageService);

    expect((await service.config()).available).toBe(false);
    await service.config();
    expect(storage.existsPrivate).toHaveBeenCalledTimes(1);
    expect(storage.existsPrivate).toHaveBeenCalledWith("maps/chile.pmtiles");
  });

  it("never reads keys outside the map files", async () => {
    const storage = { existsPrivate: jest.fn(), getPrivateStream: jest.fn() };
    const service = new MapsService(storage as unknown as StorageService);

    await expect(service.read(["restaurants", "r1", "receipts", "o1.pdf"])).resolves.toBeNull();
    expect(storage.getPrivateStream).not.toHaveBeenCalled();
    await service.read(["fonts", "Noto Sans Regular", "0-255.pbf"], "bytes=0-10");
    expect(storage.getPrivateStream).toHaveBeenCalledWith("maps/fonts/Noto Sans Regular/0-255.pbf", "bytes=0-10");
  });
});
