import { type BrowserContext, expect, test } from "@playwright/test";
import {
  CONTEXT_OPTIONS,
  ORIGIN_HEADER,
  registerViaApi,
  runId,
  uniqueEmail,
  verifyEmailViaApi,
  waitForEmailLink,
} from "./helpers";

/*
 * Staff actions with a dialog in between: cancelling with a reason the customer reads live, and the unpaid
 * hand-over warning as seen by the kitchen role (no payment registration). Runs last (file order) and
 * registers 2 users (owner and cook); registerViaApi waits out the 5/min registration limit when the earlier
 * specs used it up. Orders are placed and advanced through the api: only the step under test uses the UI.
 */
test.describe.configure({ mode: "serial", timeout: 240_000 });

const id = runId();
const ownerEmail = uniqueEmail("cancel-owner");
const cookEmail = uniqueEmail("cancel-cook");
const restaurantName = `Bajativo ${id}`;

/** Filled by the first test. */
const shared = {
  restaurantId: "",
  slug: "",
  productId: "",
  ownerState: undefined as Awaited<ReturnType<BrowserContext["storageState"]>> | undefined,
};

type Method = "post" | "patch" | "put";

async function send(context: BrowserContext, method: Method, path: string, data: unknown, status = 201) {
  const response = await context.request[method](path, { data, headers: ORIGIN_HEADER });
  expect(response.status(), await response.text()).toBe(status);
  return (await response.json()) as Record<string, unknown>;
}

/** Owner, open restaurant with pickup on and one product of $2.500, via the api. */
async function setupRestaurant(owner: BrowserContext): Promise<void> {
  await registerViaApi(owner.request, { name: "Cata Dueña", email: ownerEmail });
  await verifyEmailViaApi(owner.request, ownerEmail);
  const restaurant = await send(owner, "post", "/api/restaurants", { name: restaurantName });
  shared.restaurantId = String(restaurant.id);
  shared.slug = String(restaurant.slug);
  const base = `/api/restaurants/${shared.restaurantId}`;
  await send(owner, "patch", base, { phone: "+56 2 2345 6789", pickupEnabled: true }, 200);
  await send(owner, "put", `${base}/accepting-orders`, { acceptingOrders: true }, 200);
  const category = await send(owner, "post", `${base}/menu/categories`, { name: "Bebidas", description: "" });
  const product = await send(owner, "post", `${base}/menu/products`, {
    categoryId: category.id,
    name: "Mote con huesillo",
    description: "Bien helado",
    price: 2500,
    visible: true,
    modifierGroupIds: [],
  });
  shared.productId = String(product.id);
}

/** A pickup order placed by the customer through the public api; returns what the tracking page needs. */
async function placePickupOrder(
  customer: BrowserContext,
  customerName: string,
  customerPhone: string,
): Promise<{ orderId: string; ticket: number; trackingPath: string }> {
  const created = (await send(customer, "post", `/api/public/restaurants/${shared.slug}/orders`, {
    clientOrderId: crypto.randomUUID(),
    customerName,
    customerPhone,
    items: [{ productId: shared.productId, quantity: 1, modifiers: [] }],
  })) as unknown as { accessToken: string; order: { id: string; ticketNumber: number } };
  return {
    orderId: created.order.id,
    ticket: created.order.ticketNumber,
    trackingPath: `/pedido#t=${encodeURIComponent(created.accessToken)}`,
  };
}

/** Moves an order through the board's statuses via the api (accepting a pickup order needs a ready time). */
async function advance(owner: BrowserContext, orderId: string, statuses: string[]): Promise<void> {
  for (const status of statuses) {
    const data = status === "accepted" ? { status, readyInMinutes: 15 } : { status };
    await send(owner, "post", `/api/restaurants/${shared.restaurantId}/orders/${orderId}/status`, data, 200);
  }
}

test("cancelling an accepted order asks for a reason, and the customer sees it live", async ({ browser }) => {
  const owner = await browser.newContext(CONTEXT_OPTIONS);
  const customer = await browser.newContext(CONTEXT_OPTIONS);
  try {
    await setupRestaurant(owner);
    const order = await placePickupOrder(customer, "Tere", "+56 9 4444 0001");
    await advance(owner, order.orderId, ["accepted"]);

    // The customer follows the order; the staff cancel it from the live board.
    const phone = await customer.newPage();
    await phone.goto(order.trackingPath);
    await expect(phone.getByTestId("order-status")).toHaveText("Aceptado");

    const board = await owner.newPage();
    await board.goto(`/admin/${shared.restaurantId}/pedidos`);
    await expect(board.getByTestId("live-badge")).toHaveText("En vivo");
    const card = board.getByTestId("column-accepted").locator(`[data-ticket="${order.ticket}"]`);
    await card.getByRole("button", { name: "Cancelar pedido" }).click();

    const dialog = board.getByRole("dialog", { name: `Cancelar pedido #${order.ticket}` });
    await expect(dialog).toContainText("El cliente verá el motivo en su teléfono. No se puede deshacer.");
    const confirm = dialog.getByRole("button", { name: "Cancelar pedido" });

    // No reason: nothing is sent and the dialog says why.
    await confirm.click();
    await expect(dialog.getByText("Indica el motivo: el cliente lo verá")).toBeVisible();
    await expect(dialog).toBeVisible();

    // A quick reason fills the field (and clears the error); the staff can still write their own.
    const quick = dialog.getByRole("group", { name: "Motivos rápidos" });
    await expect(quick.getByRole("button")).toHaveText([
      "El cliente lo pidió",
      "Se acabó un ingrediente",
      "No pudimos contactar al cliente",
    ]);
    await quick.getByRole("button", { name: "No pudimos contactar al cliente" }).click();
    const reason = dialog.getByLabel("Motivo");
    await expect(reason).toHaveValue("No pudimos contactar al cliente");
    await expect(dialog.getByText("Indica el motivo: el cliente lo verá")).toHaveCount(0);
    await reason.fill("Se nos cortó la luz, disculpa");
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    await expect(board.locator(`[data-testid="order-card"][data-ticket="${order.ticket}"]`)).toHaveCount(0);

    // The customer sees it without reloading, with the staff's reason.
    await expect(phone.getByTestId("order-status")).toHaveText("Cancelado");
    await expect(phone.getByTestId("cancel-reason")).toHaveText("Motivo: Se nos cortó la luz, disculpa");

    // "Hoy" keeps it as cancelled.
    await board.getByRole("tab", { name: "Hoy" }).click();
    const row = board.getByRole("list", { name: "Pedidos de hoy" }).getByTestId("today-row").filter({ hasText: "Tere" });
    await expect(row).toContainText("Cancelado");
  } finally {
    shared.ownerState = await owner.storageState();
    await owner.close();
    await customer.close();
  }
});

test("the kitchen hands over an unpaid pickup order: warned, but not offered to register the payment", async ({ browser }) => {
  expect(shared.ownerState, "the first test signs the owner in").toBeDefined();
  const owner = await browser.newContext({ ...CONTEXT_OPTIONS, storageState: shared.ownerState });
  const cook = await browser.newContext(CONTEXT_OPTIONS);
  const customer = await browser.newContext(CONTEXT_OPTIONS);
  try {
    // The owner invites a cook (kitchen role only), who signs up and accepts through the api.
    await send(owner, "post", `/api/restaurants/${shared.restaurantId}/invitations`, { email: cookEmail, roles: ["kitchen"] });
    await registerViaApi(cook.request, { name: "Nico Cocina", email: cookEmail });
    const token = new URL(await waitForEmailLink(cookEmail, "/invitacion"), "https://x").searchParams.get("token");
    await send(cook, "post", "/api/invitations/accept", { token }, 200);

    const order = await placePickupOrder(customer, "Úrsula", "+56 9 4444 0002");
    await advance(owner, order.orderId, ["accepted", "preparing", "ready"]);
    const phone = await customer.newPage();
    await phone.goto(order.trackingPath);
    await expect(phone.getByTestId("order-status")).toHaveText("Listo");

    const board = await cook.newPage();
    await board.goto(`/admin/${shared.restaurantId}/pedidos`);
    await expect(board.getByTestId("live-badge")).toHaveText("En vivo");
    const card = board.getByTestId("column-ready").locator(`[data-ticket="${order.ticket}"]`);
    await expect(card).toContainText("Sin pagar");
    await expect(card.getByRole("button", { name: "Registrar pago" })).toHaveCount(0);
    await card.getByRole("button", { name: "Entregar" }).click();

    // The unpaid warning, without the payment methods (kitchen cannot register payments).
    const warning = board.getByRole("dialog", { name: `Pedido #${order.ticket} sin pagar` });
    await expect(warning).toContainText("Total $2.500.");
    await expect(warning).toContainText("Avísale a caja antes de entregarlo.");
    await expect(warning.getByRole("group", { name: "Registrar pago y entregar" })).toHaveCount(0);
    await expect(warning.getByRole("button", { name: /y entregar$/ })).toHaveCount(0);
    // Only going back, handing over anyway and the dialog's own close (X) button.
    await expect(warning.getByRole("button")).toHaveCount(3);
    await expect(warning.getByRole("button", { name: "Cancelar", exact: true })).toBeVisible();
    await expect(warning.getByRole("button", { name: "Cerrar" })).toBeVisible();
    await warning.getByRole("button", { name: "Entregar sin pagar" }).click();
    await expect(warning).toHaveCount(0);
    await expect(board.locator(`[data-testid="order-card"][data-ticket="${order.ticket}"]`)).toHaveCount(0);

    // Handed over and still unpaid, for the customer and in "Hoy".
    await expect(phone.getByTestId("order-status")).toHaveText("Retirado");
    await board.getByRole("tab", { name: "Hoy" }).click();
    const row = board.getByRole("list", { name: "Pedidos de hoy" }).getByTestId("today-row").filter({ hasText: "Úrsula" });
    await expect(row).toContainText("Retirado");
    await expect(row).toContainText("Sin pagar");
    await expect(row.getByRole("button", { name: "Registrar pago" })).toHaveCount(0);
  } finally {
    await owner.close();
    await cook.close();
    await customer.close();
  }
});
