import { type BrowserContext, expect, test } from "@playwright/test";
import { CONTEXT_OPTIONS, ORIGIN_HEADER, registerViaApi, runId, uniqueEmail, verifyEmailViaApi, waitForHydration } from "./helpers";

/*
 * Live floor view (phase 9), on a desktop screen (the scene; phones get the list per zone): without a plan the
 * owner sees the kitchen and the notice to draw the plan, with no dining room; once a plan with 2 tables is
 * saved through the api and a table orders, that table shows «pedido en cocina» and its ticket floats over
 * the kitchen. The restaurant has neither pickup nor delivery: no counter, no door. Registers 1 user.
 */
test.describe.configure({ mode: "serial", timeout: 150_000 });

const id = runId();
const ownerEmail = uniqueEmail("live-owner");
const DESKTOP = { ...CONTEXT_OPTIONS, viewport: { width: 1440, height: 1000 }, isMobile: false, hasTouch: false };

async function send(context: BrowserContext, method: "post" | "patch" | "put", path: string, data: unknown, status = 200) {
  const response = await context.request[method](path, { data, headers: ORIGIN_HEADER });
  expect(response.status(), await response.text()).toBe(status);
  return (await response.json()) as Record<string, unknown>;
}

test("the live view draws only the zones in use and follows a table order into the kitchen", async ({ browser }) => {
  const owner = await browser.newContext(DESKTOP);
  try {
    await registerViaApi(owner.request, { name: "Vera Dueña", email: ownerEmail });
    await verifyEmailViaApi(owner.request, ownerEmail);
    const restaurant = await send(owner, "post", "/api/restaurants", { name: `Brasa ${id}` }, 201);
    const base = `/api/restaurants/${String(restaurant.id)}`;
    await send(owner, "patch", base, { phone: "+56 2 2345 6789" });
    await send(owner, "put", `${base}/accepting-orders`, { acceptingOrders: true });
    const category = await send(owner, "post", `${base}/menu/categories`, { name: "Parrilla", description: "" }, 201);
    const product = await send(
      owner,
      "post",
      `${base}/menu/products`,
      { categoryId: category.id, name: "Lomo a lo pobre", description: "", price: 9900, visible: true, modifierGroupIds: [] },
      201,
    );
    const table1 = await send(owner, "post", `${base}/tables`, { label: "Mesa 1" }, 201);
    const table2 = await send(owner, "post", `${base}/tables`, { label: "Mesa 2" }, 201);

    // No plan yet: the kitchen (default scene) and the notice; no dining room, counter nor door.
    const page = await owner.newPage();
    await page.goto(`/admin/${String(restaurant.id)}/en-vivo`);
    await waitForHydration(page);
    await expect(page.getByTestId("live-scene")).toBeVisible();
    await expect(page.getByTestId("live-kitchen")).toHaveCount(1);
    await expect(page.getByTestId("live-plan-notice")).toContainText("Dibuja el plano de tu local para ver tus mesas");
    await expect(page.getByTestId("live-plan-notice").getByRole("link")).toHaveAttribute("href", `/admin/${String(restaurant.id)}/mesas/plano`);
    await expect(page.getByTestId("live-dining")).toHaveCount(0);
    await expect(page.getByTestId("live-table")).toHaveCount(0);
    await expect(page.getByTestId("live-pickup")).toHaveCount(0);
    await expect(page.getByTestId("live-door")).toHaveCount(0);
    await expect(page.getByTestId("kpi-tables")).toHaveCount(0);

    // The owner saves a plan with both tables (the live view receives `floor-plan.updated`).
    await send(owner, "put", `${base}/floor-plan`, {
      plan: { cols: 14, rows: 9, kitchen: { x: 0, y: 0, w: 4, h: 3 }, pickup: null, door: null },
      tables: [
        { tableId: table1.id, layout: { x: 6, y: 4, shape: "round", seats: 4 } },
        { tableId: table2.id, layout: { x: 9, y: 4, shape: "square", seats: 6 } },
      ],
    });
    await expect(page.getByTestId("live-dining")).toHaveCount(1);
    await expect(page.getByTestId("live-table")).toHaveCount(2);
    await expect(page.getByTestId("live-plan-notice")).toHaveCount(0);
    const mesa1 = page.locator('[data-testid="live-table"][data-label="Mesa 1"]');
    await expect(mesa1).toHaveAttribute("data-state", "free");

    // A customer orders from the QR of «Mesa 1»: the table waits for the kitchen, the ticket is pending.
    const ordered = await owner.request.post(`/api/public/tables/${String(table1.token)}/orders`, {
      data: { clientOrderId: crypto.randomUUID(), items: [{ productId: product.id, quantity: 2, modifiers: [] }] },
      headers: ORIGIN_HEADER,
    });
    expect(ordered.status(), await ordered.text()).toBe(201);
    const ticket = ((await ordered.json()) as { order: { ticketNumber: number } }).order.ticketNumber;
    await expect(mesa1).toHaveAttribute("data-state", "kitchen");
    const pending = page.locator('[data-testid="live-ticket-group"][data-group="pending"]').getByTestId("live-ticket");
    await expect(pending).toHaveCount(1);
    await expect(pending).toContainText(`#${ticket}`);
    await expect(pending).toContainText("Mesa 1");
    await expect(page.locator('[data-testid="live-table"][data-label="Mesa 2"]')).toHaveAttribute("data-state", "free");

    // Clicking the table opens its detail with the order in progress.
    await mesa1.click();
    await expect(page.getByTestId("live-detail-title")).toHaveText("Mesa 1");
    await expect(page.getByTestId("live-detail")).toContainText("Pedido en cocina");
    await expect(page.getByTestId("live-detail")).toContainText("2 × Lomo a lo pobre");

    // Still no counter nor door: the restaurant does not use pickup or delivery.
    await expect(page.getByTestId("live-pickup")).toHaveCount(0);
    await expect(page.getByTestId("live-door")).toHaveCount(0);
    await expect(page.getByRole("tab", { name: /Retiro/ })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: /Repartos/ })).toHaveCount(0);
  } finally {
    await owner.close();
  }
});
