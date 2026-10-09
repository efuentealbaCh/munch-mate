import type { TableContext, TableView } from "@app/types";
import { isNameTaken } from "@app/utils";
import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { apiError } from "../../common/errors/api-error";
import type { ApiEnv } from "../../config/env.validation";
import { PdfQueue } from "../../infra/queue/pdf.queue";
import { StorageService } from "../../infra/storage/storage.service";
import type { TenantContext } from "../restaurants/restaurant-access.guard";
import { openState } from "../restaurants/restaurant.views";
import { RestaurantsRepository } from "../restaurants/restaurants.repository";
import { generateTableToken } from "./order-tokens";
import { type TableRecord, TablesRepository } from "./tables.repository";

const tableNotFound = () => new NotFoundException(apiError("TABLE_NOT_FOUND", "La mesa no existe"));
const labelTaken = (label: string) =>
  new ConflictException(apiError("TABLE_LABEL_TAKEN", `Ya tienes una mesa llamada «${label}»; usa otro nombre`));
const qrNotFound = () =>
  new NotFoundException(apiError("TABLE_NOT_FOUND", "Este código QR no está activo. Pide ayuda al personal."));

export type QrSheetResult = { status: "pending" } | { status: "ready"; pdf: Buffer };

@Injectable()
export class TablesService {
  private readonly appUrl: string;

  constructor(
    private readonly tables: TablesRepository,
    private readonly restaurants: RestaurantsRepository,
    private readonly pdfQueue: PdfQueue,
    private readonly storage: StorageService,
    config: ConfigService<ApiEnv, true>,
  ) {
    this.appUrl = config.get("APP_URL", { infer: true });
  }

  async list(restaurantId: string): Promise<TableView[]> {
    return (await this.tables.list(restaurantId)).map(toView);
  }

  /** @throws ConflictException TABLE_LABEL_TAKEN (same label ignoring case, accents and spaces). */
  async create(restaurantId: string, label: string): Promise<TableView> {
    await this.assertLabelFree(restaurantId, label);
    return toView(await this.tables.create(restaurantId, label, generateTableToken));
  }

  /** @throws NotFoundException TABLE_NOT_FOUND; ConflictException TABLE_LABEL_TAKEN. */
  async update(restaurantId: string, tableId: string, changes: { label?: string; active?: boolean }): Promise<TableView> {
    if (changes.label !== undefined) await this.assertLabelFree(restaurantId, changes.label, tableId);
    const updated = await this.tables.update(restaurantId, tableId, changes);
    if (!updated) throw tableNotFound();
    return toView(updated);
  }

  /**
   * Issues a new QR code for a table: the old printed QR stops working immediately. Useful if a photo of
   * the QR circulates and someone sends orders from outside the restaurant.
   */
  async regenerateToken(restaurantId: string, tableId: string): Promise<TableView> {
    const updated = await this.tables.update(restaurantId, tableId, { token: generateTableToken() });
    if (!updated) throw tableNotFound();
    return toView(updated);
  }

  /** Past orders keep their table label snapshot, so deleting a table never alters history. */
  async delete(restaurantId: string, tableId: string): Promise<void> {
    if (!(await this.tables.delete(restaurantId, tableId))) throw tableNotFound();
  }

  /** What the customer's phone needs after scanning a QR. Inactive tables and suspended restaurants → 404. */
  async contextForToken(token: string): Promise<TableContext> {
    const table = await this.tables.findByToken(token);
    const restaurant = table?.active ? await this.restaurants.findById(table.restaurantId) : null;
    if (!table || !restaurant || restaurant.status !== "active") throw qrNotFound();
    return {
      tableLabel: table.label,
      restaurant: { name: restaurant.name, slug: restaurant.slug },
      acceptingOrders: restaurant.acceptingOrders,
      openState: openState(restaurant),
    };
  }

  /**
   * Asks the workers for a printable PDF with the QR of every active table.
   * @throws UnprocessableEntityException NO_ACTIVE_TABLES.
   */
  async requestQrSheet(tenant: TenantContext): Promise<{ jobId: string }> {
    const [restaurant, tables] = await Promise.all([
      this.restaurants.findById(tenant.restaurantId),
      this.tables.list(tenant.restaurantId),
    ]);
    const active = tables.filter((t) => t.active);
    if (!restaurant || active.length === 0) {
      throw new UnprocessableEntityException(apiError("NO_ACTIVE_TABLES", "Crea al menos una mesa activa"));
    }
    const { jobId } = await this.pdfQueue.enqueueQrSheet({
      restaurantId: tenant.restaurantId,
      restaurantName: restaurant.name,
      tables: active.map((t) => ({ label: t.label, url: this.qrUrl(t) })),
    });
    return { jobId };
  }

  /**
   * @throws NotFoundException QR_SHEET_NOT_FOUND (unknown, expired, or another restaurant's job);
   *   UnprocessableEntityException QR_SHEET_FAILED.
   */
  async getQrSheet(tenant: TenantContext, jobId: string): Promise<QrSheetResult> {
    const job = await this.pdfQueue.find(jobId);
    // Job ids are not secret enough to be the only check: the job must belong to this tenant.
    if (!job || job.data.restaurantId !== tenant.restaurantId) {
      throw new NotFoundException(apiError("QR_SHEET_NOT_FOUND", "El PDF ya no está disponible; genéralo de nuevo"));
    }
    if (job.state === "failed") {
      throw new UnprocessableEntityException(apiError("QR_SHEET_FAILED", "No se pudo generar el PDF; inténtalo de nuevo"));
    }
    if (job.state === "pending") return { status: "pending" };

    const pdf = await this.storage.getPrivate(job.data.outputKey);
    if (!pdf) return { status: "pending" };
    return { status: "ready", pdf };
  }

  private async assertLabelFree(restaurantId: string, label: string, exceptId?: string): Promise<void> {
    const tables = await this.tables.list(restaurantId);
    if (isNameTaken(label, tables.map((t) => ({ id: t.id, name: t.label })), exceptId)) throw labelTaken(label);
  }

  private qrUrl(table: TableRecord): string {
    return `${this.appUrl}/m/${table.token}`;
  }
}

function toView(table: TableRecord): TableView {
  return { id: table.id, label: table.label, token: table.token, active: table.active };
}
