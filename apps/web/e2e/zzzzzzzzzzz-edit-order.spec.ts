import { type BrowserContext, expect, test } from "@playwright/test";
import { CONTEXT_OPTIONS, ORIGIN_HEADER, registerViaApi, runId, uniqueEmail, verifyEmailViaApi, waitForHydration } from "./helpers";

/*
 * Editing an order from the board: a table order changes before the kitchen starts it (one product less, one
 * unit less, one product added from the menu), the card says "Modificado" with the new total, the customer's
 * tracking page shows the notice, and once the kitchen starts the order "Modificar" disappears. Registers 1 user.
 */
test.describe.configure({ mode: "serial", timeout: 180_000 });

const id = runId();
const ownerEmail = uniqueEmail("edit-owner");
const restaurantName = `Picada ${id}`;

let owner: BrowserContext;
const shared = { restaurantId: "", tableToken: "", pizzaId: "", sodaId: "" };

async function send(context: BrowserContext, method: "post" | "patch" | "put", path: string, data: unknown, status = 200) {
  const response = await context.request[method](path, { data, headers: ORIGIN_HEADER });
  expect(response.status(), await response.text()).toBe(status);
  return (await response.json()) as Record<string, unknown>;
}

/** Open restaurant with a $10.000 pizza, a $2.000 soda, a $2.500 juice and one table. */
test.beforeAll(async ({ browser }) => {
  // The registration may wait for the rate-limit window after the rest of the suite.
  test.setTimeout(120_000);
  owner = await browser.newContext(CONTEXT_OPTIONS);
  await registerViaApi(owner.request, { name: "Elena Dueña", email: ownerEmail });
  await verifyEmailViaApi(owner.request, ownerEmail);
  const restaurant = await send(owner, "post", "/api/restaurants", { name: restaurantName }, 201);
  shared.restaurantId = String(restaurant.id);
  const base = `/api/restaurants/${shared.restaurantId}`;
  await send(owner, "put", `${base}/accepting-orders`, { acceptingOrders: true });
  const category = await send(owner, "post", `${base}/menu/categories`, { name: "Carta", description: "" }, 201);
  const product = (name: string, price: number) =>
    send(owner, "post", `${base}/menu/products`, { categoryId: category.id, name, description: "", price, visible: true, modifierGroupIds: [] }, 201);
  shared.pizzaId = String((await product("Pizza", 10000)).id);
  shared.sodaId = String((await product("Bebida", 2000)).id);
  await product("Jugo", 2500);
  const table = await send(owner, "post", `${base}/tables`, { label: "Mesa 5" }, 201);
  shared.tableToken = String(table.token);
});

test.afterAll(async () => {
  await owner?.close();
});

test("the staff edit a table order before the kitchen starts it and the customer sees it", async ({ browser }) => {
  const customer = await browser.newContext(CONTEXT_OPTIONS);
  try {
    // The customer orders 2 pizzas and a soda ($22.000) from the table QR.
    const created = await send(
      customer,
      "post",
      `/api/public/tables/${shared.tableToken}/orders`,
      {
        clientOrderId: crypto.randomUUID(),
        items: [
          { productId: shared.pizzaId, quantity: 2, modifiers: [] },
          { productId: shared.sodaId, quantity: 1, modifiers: [] },
        ],
      },
      201,
    );
    const accessToken = String(created.accessToken);

    const board = await owner.newPage();
    await board.goto(`/admin/${shared.restaurantId}/pedidos`);
    await waitForHydration(board);
    const card = board.getByTestId("order-card").filter({ hasText: "Mesa 5" });
    await expect(card.getByTestId("order-total")).toHaveText("$22.000");
    await expect(card.getByTestId("order-edited")).toHaveCount(0);

    // "Modificar": one pizza less, no soda, a juice from the menu.
    await card.getByTestId("edit-order").click();
    const dialog = board.getByRole("dialog", { name: /Modificar pedido #/ });
    await expect(dialog.getByTestId("save-edit")).toBeDisabled();
    await dialog.getByRole("group", { name: "Cantidad de Pizza" }).getByRole("button", { name: "Quitar uno" }).click();
    await dialog.getByRole("button", { name: "Quitar Bebida" }).click();
    await expect(dialog.getByTestId("edit-total")).toHaveText("$10.000");
    await dialog.getByTestId("edit-add-product").click();
    await dialog.getByTestId("edit-menu-product").filter({ hasText: "Jugo" }).click();
    await board.getByRole("dialog", { name: "Jugo" }).getByRole("button", { name: "Agregar $2.500" }).click();
    await expect(dialog.getByTestId("edit-added-line")).toContainText("Jugo");
    await expect(dialog.getByTestId("edit-total")).toHaveText("$12.500");
    await dialog.getByLabel("Motivo (opcional)").fill("Cambió la bebida por un jugo");
    await dialog.getByTestId("save-edit").click();
    await expect(dialog).toBeHidden();

    // The card: "Modificado", the new items and total, and the history with the reason.
    await expect(card.getByTestId("order-edited")).toHaveText("Modificado");
    await expect(card.getByTestId("order-total")).toHaveText("$12.500");
    await expect(card.getByRole("list", { name: "Productos" })).toContainText("1 × Pizza");
    await expect(card.getByRole("list", { name: "Productos" })).toContainText("1 × Jugo");
    await expect(card.getByRole("list", { name: "Productos" })).not.toContainText("Bebida");
    await card.getByTestId("order-edits").locator("summary").click();
    await expect(card.getByTestId("order-edits")).toContainText("Motivo: Cambió la bebida por un jugo");

    // The customer's tracking page: the notice above the updated detail.
    const phone = await customer.newPage();
    await phone.goto(`/pedido#t=${encodeURIComponent(accessToken)}`);
    await waitForHydration(phone);
    await expect(phone.getByTestId("order-edited-notice")).toContainText("El local modificó tu pedido");
    await expect(phone.getByTestId("order-total")).toHaveText("$12.500");

    // Still editable once accepted; not after the kitchen starts it.
    await card.getByRole("button", { name: "Aceptar", exact: true }).click();
    await expect(card.getByTestId("edit-order")).toBeVisible();
    await card.getByRole("button", { name: "Empezar" }).click();
    await expect(board.getByTestId("column-preparing").getByTestId("order-card").filter({ hasText: "Mesa 5" })).toBeVisible();
    await expect(board.getByTestId("order-card").filter({ hasText: "Mesa 5" }).getByTestId("edit-order")).toHaveCount(0);
    await board.close();
  } finally {
    await customer.close();
  }
});
