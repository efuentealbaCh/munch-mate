import type { ConfigService } from "@nestjs/config";
import type { ApiEnv } from "../../config/env.validation";
import type { PdfQueue } from "../../infra/queue/pdf.queue";
import type { StorageService } from "../../infra/storage/storage.service";
import type { TenantContext } from "../restaurants/restaurant-access.guard";
import type { RestaurantsRepository } from "../restaurants/restaurants.repository";
import type { TablesRepository } from "./tables.repository";
import { TablesService } from "./tables.service";

const tenant: TenantContext = { restaurantId: "r1", roles: ["owner"], status: "active" };

function setup(options: {
  tables?: { id: string; label: string; token: string; active: boolean }[];
  job?: { state: "pending" | "completed" | "failed"; data: { restaurantId: string; outputKey: string } } | null;
  restaurantStatus?: "active" | "suspended";
} = {}) {
  const pdfQueue = {
    enqueueQrSheet: jest.fn(async () => ({ jobId: "job-1", outputKey: "k" })),
    find: jest.fn(async () => options.job ?? null),
  };
  const tables = {
    list: jest.fn(async () => (options.tables ?? []).map((t) => ({ ...t, restaurantId: "r1" }))),
    findByToken: jest.fn(async () => ({ id: "t1", restaurantId: "r1", label: "Mesa 1", token: "abc", active: true })),
    update: jest.fn(async () => null),
    delete: jest.fn(async () => false),
  };
  const service = new TablesService(
    tables as unknown as TablesRepository,
    {
      findById: jest.fn(async () => ({
        id: "r1",
        name: "Don Pepe",
        slug: "don-pepe",
        acceptingOrders: false,
        status: options.restaurantStatus ?? "active",
      })),
    } as unknown as RestaurantsRepository,
    pdfQueue as unknown as PdfQueue,
    { getPrivate: jest.fn(async () => Buffer.from("%PDF-")) } as unknown as StorageService,
    { get: () => "https://munchmate.cl" } as unknown as ConfigService<ApiEnv, true>,
  );
  return { service, pdfQueue };
}

describe("TablesService", () => {
  it("sends only active tables, with their QR URLs, to the PDF job", async () => {
    const { service, pdfQueue } = setup({
      tables: [
        { id: "1", label: "Mesa 1", token: "aaa", active: true },
        { id: "2", label: "Mesa 2", token: "bbb", active: false },
      ],
    });

    await service.requestQrSheet(tenant);

    expect(pdfQueue.enqueueQrSheet).toHaveBeenCalledWith({
      restaurantId: "r1",
      restaurantName: "Don Pepe",
      tables: [{ label: "Mesa 1", url: "https://munchmate.cl/m/aaa" }],
    });
  });

  it("needs at least one active table", async () => {
    await expect(setup({ tables: [] }).service.requestQrSheet(tenant)).rejects.toMatchObject({
      response: { code: "NO_ACTIVE_TABLES" },
    });
  });

  it("never serves another restaurant's PDF", async () => {
    const { service } = setup({ job: { state: "completed", data: { restaurantId: "other", outputKey: "k" } } });

    await expect(service.getQrSheet(tenant, "job-1")).rejects.toMatchObject({ response: { code: "QR_SHEET_NOT_FOUND" } });
  });

  it("reports pending, failed and ready jobs", async () => {
    const data = { restaurantId: "r1", outputKey: "k" };
    await expect(setup({ job: { state: "pending", data } }).service.getQrSheet(tenant, "j")).resolves.toEqual({
      status: "pending",
    });
    await expect(setup({ job: { state: "failed", data } }).service.getQrSheet(tenant, "j")).rejects.toMatchObject({
      response: { code: "QR_SHEET_FAILED" },
    });
    await expect(setup({ job: { state: "completed", data } }).service.getQrSheet(tenant, "j")).resolves.toMatchObject({
      status: "ready",
    });
  });

  it("hides tables of suspended restaurants and reports unknown tables", async () => {
    await expect(setup({ restaurantStatus: "suspended" }).service.contextForToken("abc")).rejects.toMatchObject({
      response: { code: "TABLE_NOT_FOUND" },
    });
    await expect(setup().service.update("r1", "x", { label: "y" })).rejects.toMatchObject({
      response: { code: "TABLE_NOT_FOUND" },
    });
    await expect(setup().service.delete("r1", "x")).rejects.toMatchObject({ response: { code: "TABLE_NOT_FOUND" } });
  });
});
