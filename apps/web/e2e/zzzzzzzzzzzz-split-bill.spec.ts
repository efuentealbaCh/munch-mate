import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { CONTEXT_OPTIONS, ORIGIN_HEADER, registerViaApi, runId, uniqueEmail, verifyEmailViaApi, waitForHydration } from "./helpers";

/*
 * Split table bills (phase 8) in the browser: the owner charges a table from «Salón» in two equal parts (cash,
 * then card: the last one closes the account) while the table's phone follows the payments live; then a
 * second account paid by products, with a payment cancelled on the way. Registers 1 user (the owner).
 */
test.describe.configure({ mode: "serial", timeout: 240_000 });

const id = runId();
const ownerEmail = uniqueEmail("split-owner");
const restaurantName = `Cocinería ${id}`;

const shared = { restaurantId: "", tableToken: "", lasagnaId: "", drinkId: "" };

async function send(context: BrowserContext, method: "post" | "patch" | "put", path: string, data: unknown, status = 200) {
  const response = await context.request[method](path, { data, headers: ORIGIN_HEADER });
  expect(response.status(), await response.text()).toBe(status);
  return (await response.json()) as Record<string, unknown>;
}

/** Open restaurant (10 % suggested tip by default) with a $10.000 lasagna, a $2.000 drink and "Mesa 3". */
async function setup(owner: BrowserContext): Promise<void> {
  await registerViaApi(owner.request, { name: "Olga Dueña", email: ownerEmail });
  await verifyEmailViaApi(owner.request, ownerEmail);
  const restaurant = await send(owner, "post", "/api/restaurants", { name: restaurantName }, 201);
  shared.restaurantId = String(restaurant.id);
  const base = `/api/restaurants/${shared.restaurantId}`;
  await send(owner, "patch", base, { phone: "+56 2 2345 6789" });
  await send(owner, "put", `${base}/accepting-orders`, { acceptingOrders: true });
  const category = await send(owner, "post", `${base}/menu/categories`, { name: "Platos", description: "" }, 201);
  const product = (name: string, price: number) =>
    send(owner, "post", `${base}/menu/products`, { categoryId: category.id, name, description: "", price, visible: true, modifierGroupIds: [] }, 201);
  shared.lasagnaId = String((await product("Lasaña", 10000)).id);
  shared.drinkId = String((await product("Bebida", 2000)).id);
  const table = await send(owner, "post", `${base}/tables`, { label: "Mesa 3" }, 201);
  shared.tableToken = String(table.token);
}

/** A table order through the public api (the QR flow itself is covered by the floor spec). */
async function orderAtTable(context: BrowserContext, items: { productId: string; quantity: number }[]) {
  await send(
    context,
    "post",
    `/api/public/tables/${shared.tableToken}/orders`,
    { clientOrderId: crypto.randomUUID(), items: items.map((item) => ({ ...item, modifiers: [] })) },
    201,
  );
}

/** The kitchen serves every new order (through the api: these tests are about charging). */
async function serveAll(owner: BrowserContext) {
  const base = `/api/restaurants/${shared.restaurantId}`;
  const active = (await (await owner.request.get(`${base}/orders`)).json()) as { id: string; status: string }[];
  for (const order of active.filter((o) => o.status === "pending")) {
    for (const status of ["accepted", "preparing", "ready", "served"]) {
      await send(owner, "post", `${base}/orders/${order.id}/status`, { status });
    }
  }
}

async function openFloor(page: Page) {
  await page.goto(`/admin/${shared.restaurantId}/salon`);
  await waitForHydration(page);
  return page.getByTestId("table-session").filter({ hasText: "Mesa 3" });
}

async function openPhoneBill(phone: Page) {
  await phone.goto(`/m/${shared.tableToken}`);
  await waitForHydration(phone);
  await phone.getByTestId("my-bill").click();
  return phone.getByTestId("bill-sheet");
}

let owner: BrowserContext;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  owner = await browser.newContext(CONTEXT_OPTIONS);
  await setup(owner);
});

test.afterAll(async () => {
  await owner?.close();
});

test("a table pays in two equal parts, cash and card, and the phone follows each payment", async ({ browser }) => {
  const customer = await browser.newContext(CONTEXT_OPTIONS);
  try {
    await orderAtTable(customer, [{ productId: shared.lasagnaId, quantity: 1 }]);
    await orderAtTable(customer, [{ productId: shared.lasagnaId, quantity: 1 }]);
    await serveAll(owner);

    const floor = await owner.newPage();
    const table = await openFloor(floor);
    await expect(table.getByTestId("session-subtotal")).toHaveText("$20.000");
    await table.getByTestId("charge-table").click();
    const charge = floor.getByRole("dialog", { name: "Cobrar Mesa 3" });
    await expect(charge.getByTestId("charge-remaining")).toHaveText("$20.000");

    // Two equal parts (the plan is saved, so the phone sees it too).
    await charge.getByRole("radio", { name: "Partes iguales" }).click();
    await expect(charge.getByTestId("equal-part")).toHaveCount(2);
    await expect(table.getByTestId("split-chip")).toHaveText("2 partes");

    // Part 1 in cash, with the suggested 10 % of the part.
    await charge.getByRole("button", { name: "Cobrar parte 1" }).click();
    await expect(charge.getByTestId("payment-amount")).toHaveText("$10.000");
    await expect(charge.getByTestId("charge-total")).toHaveText("$11.000");
    await charge.getByRole("radio", { name: "Efectivo" }).click();
    await charge.getByTestId("confirm-charge").click();
    await expect(charge.getByTestId("charge-paid")).toHaveText("$10.000");
    await expect(charge.getByTestId("charge-remaining")).toHaveText("$10.000");
    await expect(charge.locator('[data-testid="equal-part"][data-status="paid"]')).toContainText("Parte 1 · Efectivo · $10.000");

    // The table's phone: the plan, the payment (no names) and the balance.
    const phone = await customer.newPage();
    const sheet = await openPhoneBill(phone);
    await expect(sheet.getByTestId("bill-plan")).toHaveText("Dividida en 2 partes de $10.000");
    await expect(sheet.getByTestId("bill-payment")).toHaveText("Parte 1 · Efectivo · $10.000");
    await expect(sheet.getByTestId("bill-balance")).toContainText("Pagado $10.000");
    await expect(sheet.getByTestId("bill-balance")).toContainText("Falta $10.000");
    await expect(sheet.getByTestId("bill-pending-parts")).toHaveText("Falta la parte 2 de $10.000");

    // Part 2 by card closes the account: both screens say so.
    await charge.getByRole("button", { name: "Cobrar parte 2" }).click();
    await charge.getByRole("radio", { name: "Tarjeta (POS)" }).click();
    await charge.getByTestId("confirm-charge").click();
    await expect(floor.getByText("Cuenta pagada · Mesa 3")).toBeVisible();
    await expect(floor.getByTestId("table-session").filter({ hasText: "Mesa 3" })).toHaveCount(0);
    await expect(sheet.getByTestId("bill-paid")).toContainText("Cuenta pagada");
    await expect(phone.getByTestId("my-bill")).toHaveText("Cuenta pagada");

    // "Hoy" on the board shows how each order was paid (part 1 paid the oldest order, part 2 the other).
    const board = await owner.newPage();
    await board.goto(`/admin/${shared.restaurantId}/pedidos`);
    await waitForHydration(board);
    await board.getByRole("tab", { name: "Hoy" }).click();
    const today = board.getByRole("list", { name: "Pedidos de hoy" });
    await expect(today.getByTestId("payment-badge").filter({ hasText: "Pagado · Efectivo" })).toHaveCount(1);
    await expect(today.getByTestId("payment-badge").filter({ hasText: "Pagado · Tarjeta (POS)" })).toHaveCount(1);
    await board.close();
    await floor.close();
  } finally {
    await customer.close();
  }
});

test("a table pays by products, with a payment cancelled on the way", async ({ browser }) => {
  const customer = await browser.newContext(CONTEXT_OPTIONS);
  try {
    // A new account: two lasagnas and a drink in one order ($22.000).
    await orderAtTable(customer, [
      { productId: shared.lasagnaId, quantity: 2 },
      { productId: shared.drinkId, quantity: 1 },
    ]);
    await serveAll(owner);

    const floor = await owner.newPage();
    const table = await openFloor(floor);
    await expect(table.getByTestId("session-subtotal")).toHaveText("$22.000");
    await table.getByTestId("charge-table").click();
    const charge = floor.getByRole("dialog", { name: "Cobrar Mesa 3" });
    await charge.getByRole("radio", { name: "Por productos" }).click();
    await expect(charge.getByTestId("split-item")).toHaveCount(2);

    // One of the two lasagnas, in cash.
    await charge.getByRole("checkbox", { name: /Lasaña/ }).click();
    await expect(charge.getByTestId("selection-total")).toHaveText("2 productos · $20.000");
    await charge.getByRole("group", { name: "Unidades de Lasaña a pagar" }).getByRole("button", { name: "Quitar uno" }).click();
    await expect(charge.getByTestId("selection-total")).toHaveText("1 producto · $10.000");
    await charge.getByTestId("charge-selection").click();
    await charge.getByRole("radio", { name: "Efectivo" }).click();
    await charge.getByTestId("confirm-charge").click();
    await expect(charge.getByTestId("charge-paid")).toHaveText("$10.000");
    await expect(table.getByTestId("session-paid")).toContainText("Pagado $10.000 de $22.000");

    // The phone crosses out what was paid: one of the two lasagnas.
    const phone = await customer.newPage();
    const sheet = await openPhoneBill(phone);
    await expect(sheet.getByTestId("bill-line").filter({ hasText: "Lasaña" })).toContainText("1 de 2 pagado");
    await expect(sheet.getByTestId("bill-payment")).toHaveText("1 producto · Efectivo · $10.000");

    // It was a mistake: the payment is cancelled and the phone goes back to nothing paid.
    await charge.getByTestId("table-payment").getByRole("button", { name: /Anular/ }).click();
    await floor.getByRole("alertdialog").getByRole("button", { name: "Anular pago" }).click();
    await expect(charge.getByTestId("charge-paid")).toHaveText("$0");
    await expect(charge.getByTestId("table-payment")).toHaveCount(0);
    await expect(sheet.getByTestId("bill-payment")).toHaveCount(0);

    // Everything by products, by transfer: the account closes.
    await charge.getByRole("checkbox", { name: /Lasaña/ }).click();
    await charge.getByRole("checkbox", { name: /Bebida/ }).click();
    await expect(charge.getByTestId("selection-total")).toHaveText("3 productos · $22.000");
    await charge.getByTestId("charge-selection").click();
    await charge.getByRole("radio", { name: "Transferencia" }).click();
    await charge.getByTestId("confirm-charge").click();
    await expect(floor.getByText("Cuenta pagada · Mesa 3")).toBeVisible();
    await expect(sheet.getByTestId("bill-paid")).toBeVisible();
    await floor.close();
  } finally {
    await customer.close();
  }
});
