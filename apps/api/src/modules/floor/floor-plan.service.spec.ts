import type { FloorPlan, TableLayout } from "@app/types";
import type { Connection } from "mongoose";
import type { TableRecord, TablesRepository } from "../orders/tables.repository";
import type { RealtimeService } from "../realtime/realtime.service";
import type { TenantContext } from "../restaurants/restaurant-access.guard";
import type { RestaurantsRepository } from "../restaurants/restaurants.repository";
import { FloorPlanService } from "./floor-plan.service";

const tenant: TenantContext = { restaurantId: "r1", roles: ["owner"], status: "active" };

const PLAN: FloorPlan = {
  cols: 14,
  rows: 9,
  kitchen: { x: 0, y: 0, w: 4, h: 3 },
  pickup: null,
  door: { x: 13, y: 8 },
};
const ROUND4: TableLayout = { x: 5, y: 4, shape: "round", seats: 4 };

const tableRecord = (id: string, overrides: Partial<TableRecord> = {}): TableRecord => ({
  id,
  restaurantId: "r1",
  label: `Mesa ${id}`,
  token: `tok-${id}`,
  active: true,
  layout: null,
  ...overrides,
});

function setup(options: { tables?: TableRecord[]; plan?: FloorPlan | null; restaurantExists?: boolean } = {}) {
  const state = { plan: options.plan ?? null, tables: options.tables ?? [tableRecord("t1"), tableRecord("t2")] };
  const events: string[] = [];
  const session = { id: "tx" };
  const restaurants = {
    findById: jest.fn(async () => (options.restaurantExists === false ? null : { id: "r1", floorPlan: state.plan })),
    setFloorPlan: jest.fn(async (_id: string, plan: FloorPlan | null, s: unknown) => {
      events.push(`plan:${s === session ? "tx" : "no-tx"}`);
      if (options.restaurantExists === false) return false;
      state.plan = plan;
      return true;
    }),
  };
  const tables = {
    list: jest.fn(async () => state.tables),
    replaceLayouts: jest.fn(async (_id: string, layouts: { tableId: string; layout: TableLayout }[], s: unknown) => {
      events.push(`layouts:${s === session ? "tx" : "no-tx"}`);
      const byId = new Map(layouts.map((l) => [l.tableId, l.layout]));
      state.tables = state.tables.map((t) => ({ ...t, layout: byId.get(t.id) ?? null }));
    }),
  };
  const emit = jest.fn();
  const realtime = { toRestaurant: jest.fn(() => ({ emit })) };
  const connection = {
    transaction: jest.fn(async (fn: (s: unknown) => Promise<unknown>) => {
      events.push("begin");
      const result = await fn(session);
      events.push("commit");
      return result;
    }),
  };
  const service = new FloorPlanService(
    restaurants as unknown as RestaurantsRepository,
    tables as unknown as TablesRepository,
    connection as unknown as Connection,
    realtime as unknown as RealtimeService,
  );
  return { service, restaurants, tables, realtime, emit, connection, events, state };
}

describe("FloorPlanService", () => {
  it("lists every table, placed or not, and hides layouts while there is no plan", async () => {
    const { service } = setup({ tables: [tableRecord("t1", { layout: ROUND4 }), tableRecord("t2", { active: false })] });

    expect(await service.get("r1")).toEqual({
      plan: null,
      tables: [
        { id: "t1", label: "Mesa t1", active: true, layout: null },
        { id: "t2", label: "Mesa t2", active: false, layout: null },
      ],
    });
  });

  it("writes the plan and the layouts in one transaction and tells the staff", async () => {
    const { service, events, emit, realtime, tables } = setup();

    const view = await service.save(tenant, {
      plan: PLAN,
      tables: [
        { tableId: "t1", layout: ROUND4 },
        { tableId: "t2", layout: null },
      ],
    });

    expect(events).toEqual(["begin", "plan:tx", "layouts:tx", "commit"]);
    expect(tables.replaceLayouts).toHaveBeenCalledWith("r1", [{ tableId: "t1", layout: ROUND4 }], { id: "tx" });
    expect(view).toEqual({
      plan: PLAN,
      tables: [
        { id: "t1", label: "Mesa t1", active: true, layout: ROUND4 },
        { id: "t2", label: "Mesa t2", active: true, layout: null },
      ],
    });
    expect(realtime.toRestaurant).toHaveBeenCalledWith("r1");
    expect(emit).toHaveBeenCalledWith("floor-plan.updated", view);
  });

  it("rejects tables of another restaurant or that do not exist, writing nothing", async () => {
    const { service, connection, emit } = setup();

    await expect(
      service.save(tenant, { plan: PLAN, tables: [{ tableId: "other-restaurant-table", layout: ROUND4 }] }),
    ).rejects.toMatchObject({
      status: 400,
      response: { code: "UNKNOWN_TABLE", meta: { tableId: "other-restaurant-table" } },
    });
    expect(connection.transaction).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it("rejects an invalid plan with the problem code, writing nothing", async () => {
    const { service, connection } = setup();

    await expect(
      service.save(tenant, {
        plan: PLAN,
        tables: [
          { tableId: "t1", layout: ROUND4 },
          { tableId: "t2", layout: { ...ROUND4, seats: 6, x: 4 } },
        ],
      }),
    ).rejects.toMatchObject({ status: 400, response: { code: "INVALID_FLOOR_PLAN", meta: { problem: "overlap" } } });
    await expect(service.save(tenant, { plan: { ...PLAN, cols: 30 }, tables: [] })).rejects.toMatchObject({
      response: { code: "INVALID_FLOOR_PLAN", meta: { problem: "size" } },
    });
    await expect(
      service.save(tenant, { plan: { ...PLAN, kitchen: null as unknown as FloorPlan["kitchen"] }, tables: [] }),
    ).rejects.toMatchObject({ response: { code: "INVALID_FLOOR_PLAN", meta: { problem: "kitchen_required" } } });
    expect(connection.transaction).not.toHaveBeenCalled();
  });

  it("with a null plan deletes the plan and every layout, ignoring the tables sent", async () => {
    const { service, tables, restaurants, state } = setup({
      plan: PLAN,
      tables: [tableRecord("t1", { layout: ROUND4 }), tableRecord("t2", { layout: { ...ROUND4, x: 7 } })],
    });

    const view = await service.save(tenant, { plan: null, tables: [{ tableId: "gone", layout: ROUND4 }] });

    expect(restaurants.setFloorPlan).toHaveBeenCalledWith("r1", null, { id: "tx" });
    expect(tables.replaceLayouts).toHaveBeenCalledWith("r1", [], { id: "tx" });
    expect(state.tables.every((t) => t.layout === null)).toBe(true);
    expect(view.plan).toBeNull();
  });

  it("answers 404 when the restaurant disappears inside the transaction", async () => {
    const { service, emit } = setup({ restaurantExists: false });

    await expect(service.save(tenant, { plan: PLAN, tables: [] })).rejects.toMatchObject({
      status: 404,
      response: { code: "RESTAURANT_NOT_FOUND" },
    });
    expect(emit).not.toHaveBeenCalled();
  });
});
