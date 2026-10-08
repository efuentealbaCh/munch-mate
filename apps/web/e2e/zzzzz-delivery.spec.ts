import { type BrowserContext, expect, type Page, test } from "@playwright/test";
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
 * Phase 5: delivery orders, zones and the rider's screen. Runs last (file order) and registers 2 users (owner
 * and rider); registerViaApi waits out the 5/min registration limit when the earlier specs used it up.
 * Set E2E_SCREENSHOTS_DIR to save mobile screenshots of the checkout, the tracking page, the board and the
 * rider's screen.
 */
test.describe.configure({ mode: "serial", timeout: 300_000 });

const id = runId();
const ownerEmail = uniqueEmail("delivery-owner");
const riderEmail = uniqueEmail("delivery-rider");
const restaurantName = `Despacho ${id}`;
const RIDER_NAME = "Rodrigo Repartidor";

/** Filled by the setup. */
const shared = { restaurantId: "", slug: "" };

async function screenshot(page: Page, name: string): Promise<void> {
  const dir = process.env.E2E_SCREENSHOTS_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: false });
}

/** Owner, open restaurant with one product of $4.500, via the api (delivery stays off: the test turns it on). */
async function setupRestaurant(context: BrowserContext): Promise<void> {
  const api = context.request;
  await registerViaApi(api, { name: "Olga Dueña", email: ownerEmail });
  await verifyEmailViaApi(api, ownerEmail);
  const send = async (method: "post" | "patch" | "put", path: string, data: unknown, status = 201) => {
    const response = await api[method](path, { data, headers: ORIGIN_HEADER });
    expect(response.status(), await response.text()).toBe(status);
    return (await response.json()) as Record<string, unknown>;
  };
  const restaurant = await send("post", "/api/restaurants", { name: restaurantName });
  shared.restaurantId = String(restaurant.id);
  shared.slug = String(restaurant.slug);
  expect(restaurant.deliveryEnabled).toBe(false);
  const base = `/api/restaurants/${shared.restaurantId}`;
  await send("patch", base, { phone: "+56 2 2345 6789" }, 200);
  await send("put", `${base}/accepting-orders`, { acceptingOrders: true }, 200);
  const category = await send("post", `${base}/menu/categories`, { name: "Pizzas", description: "" });
  await send("post", `${base}/menu/products`, {
    categoryId: category.id,
    name: "Margarita",
    description: "Tomate, mozzarella y albahaca",
    price: 4500,
    visible: true,
    modifierGroupIds: [],
  });
}

/** The owner invites a rider by email; the rider signs up and accepts through the api. */
async function inviteRider(owner: BrowserContext, rider: BrowserContext): Promise<void> {
  const invite = await owner.request.post(`/api/restaurants/${shared.restaurantId}/invitations`, {
    data: { email: riderEmail, roles: ["rider"] },
    headers: ORIGIN_HEADER,
  });
  expect(invite.status(), await invite.text()).toBe(201);
  await registerViaApi(rider.request, { name: RIDER_NAME, email: riderEmail });
  const link = await waitForEmailLink(riderEmail, "/invitacion");
  const token = new URL(link, "https://placeholder").searchParams.get("token");
  const accepted = await rider.request.post("/api/invitations/accept", { data: { token }, headers: ORIGIN_HEADER });
  expect(accepted.status(), await accepted.text()).toBeLessThan(300);
}

test("delivery: zones, cash with change, ETA, rider assignment, the rider takes it out, collects and delivers", async ({ browser }) => {
  const owner = await browser.newContext(CONTEXT_OPTIONS);
  const customer = await browser.newContext(CONTEXT_OPTIONS);
  const rider = await browser.newContext(CONTEXT_OPTIONS);
  try {
    await setupRestaurant(owner);
    const board = await owner.newPage();

    // The owner turns delivery on: without zones it warns that nobody can order yet.
    await board.goto(`/admin/${shared.restaurantId}`);
    const deliverySwitch = board.getByRole("switch", { name: /Pedidos con delivery/ });
    await expect(deliverySwitch).not.toBeChecked();
    await deliverySwitch.click();
    await expect(deliverySwitch).toBeChecked();
    await expect(board.getByText("Ahora recibes pedidos con delivery")).toBeVisible();
    await expect(board.getByTestId("no-zones-warning")).toBeVisible();

    // Two zones: Ñuñoa is the restaurant's own (preselected at checkout), Centro is free.
    const addZone = async (name: string, fee: string, minOrder: string, home: boolean) => {
      await board.getByRole("button", { name: "Agregar zona" }).click();
      const dialog = board.getByRole("dialog", { name: "Nueva zona de reparto" });
      await dialog.getByLabel("Comuna o sector").fill(name);
      await dialog.getByLabel("Costo de envío").fill(fee);
      await dialog.getByLabel("Pedido mínimo").fill(minOrder);
      if (home) await dialog.getByRole("switch", { name: "Zona del local" }).click();
      await dialog.getByRole("button", { name: "Agregar zona" }).click();
      await expect(dialog).toHaveCount(0);
    };
    await addZone("Centro", "0", "0", false);
    await addZone("Ñuñoa", "1990", "8000", true);
    const zoneRows = board.getByRole("list", { name: "Zonas de reparto" }).getByTestId("zone-row");
    await expect(zoneRows).toHaveCount(2);
    await expect(zoneRows.filter({ hasText: "Ñuñoa" })).toContainText("Zona del local");
    await expect(zoneRows.filter({ hasText: "Ñuñoa" })).toContainText("Envío $1.990 · Mínimo $8.000");
    await expect(board.getByTestId("no-zones-warning")).toHaveCount(0);

    await inviteRider(owner, rider);

    // Board open and live before the customer orders.
    await board.goto(`/admin/${shared.restaurantId}/pedidos`);
    await expect(board.getByTestId("live-badge")).toHaveText("En vivo");

    // The customer orders for delivery (only delivery is on: no channel selector).
    const phone = await customer.newPage();
    await phone.goto(`/r/${shared.slug}`);
    await expect(phone.getByTestId("pickup-banner")).toContainText("Pide aquí y te lo llevamos a domicilio.");
    await phone.getByTestId("public-product").filter({ hasText: "Margarita" }).click();
    await phone.getByRole("dialog", { name: "Margarita" }).getByRole("button", { name: "Agregar $4.500" }).click();
    await phone.getByRole("button", { name: /Ver pedido \(1\)/ }).click();
    const cart = phone.getByRole("dialog", { name: "Tu pedido" });
    await expect(cart.getByRole("radiogroup", { name: "¿Cómo quieres recibirlo?" })).toHaveCount(0);
    // The home zone is preselected; $4.500 does not reach its $8.000 minimum (the fee does not count).
    await expect(cart.getByLabel("Comuna o zona")).toHaveValue(/.+/);
    await expect(cart.getByLabel("Comuna o zona").locator("option:checked")).toHaveText(/^Ñuñoa/);
    await expect(cart.getByTestId("below-minimum")).toContainText("Agrega $3.500 más");
    const submit = cart.getByRole("button", { name: /Pedir delivery/ });
    await expect(submit).toBeDisabled();
    await cart.getByRole("group", { name: "Cantidad de Margarita" }).getByRole("button", { name: "Agregar uno" }).click();
    await expect(cart.getByTestId("below-minimum")).toHaveCount(0);
    await expect(cart.getByTestId("cart-subtotal")).toHaveText("$9.000");
    await expect(cart.getByTestId("cart-fee")).toHaveText("$1.990");
    await expect(cart.getByTestId("cart-total")).toHaveText("$10.990");

    await cart.getByLabel("Tu nombre").fill("Rita");
    await cart.getByLabel("Teléfono").fill("9 8765 4321");
    await cart.getByLabel("Calle y número").fill("Av. Italia 1234");
    await cart.getByLabel("Depto, casa u oficina (opcional)").fill("Depto 402");
    await cart.getByLabel("Referencia (opcional)").fill("Portón verde");
    // Payment is required.
    await cart.getByRole("button", { name: "Pedir delivery · $10.990" }).click();
    await expect(cart.getByText("Elige cómo vas a pagar")).toBeVisible();
    await cart.getByRole("radio", { name: "Efectivo" }).check();
    const cash = cart.getByLabel("¿Con cuánto pagas? (opcional)");
    await cash.fill("10.000");
    await cart.getByRole("button", { name: "Pedir delivery · $10.990" }).click();
    await expect(cart.getByText("Debe cubrir el total ($10.990)")).toBeVisible();
    await cash.fill("20.000");
    await expect(cart.getByTestId("cash-change")).toHaveText("Tu vuelto: $9.010");
    await screenshot(phone, "delivery-checkout");
    await cart.getByRole("button", { name: "Pedir delivery · $10.990" }).click();

    // Tracking: delivery steps, address and how the customer pays.
    await expect(phone).toHaveURL(/\/pedido#t=[A-Za-z0-9_-]{20,}$/);
    await expect(phone.getByTestId("order-status")).toHaveText("Pendiente");
    await expect(phone.getByTestId("order-destination")).toHaveText(`${restaurantName} · Delivery`);
    await expect(phone.getByRole("list", { name: "Avance del pedido" })).toContainText("En reparto");
    await expect(phone.getByTestId("delivery-address")).toContainText("Av. Italia 1234, Depto 402");
    await expect(phone.getByTestId("delivery-address")).toContainText("Ref.: Portón verde");
    await expect(phone.getByTestId("expected-payment")).toHaveText("Pagas al recibir: Efectivo (pagas con $20.000, vuelto $9.010)");
    await expect(phone.getByTestId("delivery-fee")).toHaveText("$1.990");
    await expect(phone.getByTestId("order-total")).toHaveText("$10.990");

    // The board shows it live with the zone, the address and the change to bring.
    const card = board.locator('[data-testid="order-card"][data-channel="delivery"]').filter({ hasText: "Rita" });
    await expect(card).toBeVisible();
    await expect(card.getByTestId("order-destination")).toHaveText("Delivery · Ñuñoa");
    await expect(card.getByTestId("order-address")).toContainText("Av. Italia 1234, Depto 402");
    await expect(card.getByRole("link", { name: /Ver en el mapa/ })).toHaveAttribute("href", /google\.com\/maps\/search/);
    await expect(card.getByTestId("expected-payment")).toContainText("Llevar vuelto: $9.010");
    await expect(card).toContainText("incluye envío $1.990");

    // Channel filter with delivery.
    const filter = board.getByRole("group", { name: "Filtrar por canal" });
    await filter.getByRole("button", { name: "Mesa" }).click();
    await expect(card).toHaveCount(0);
    await filter.getByRole("button", { name: "Delivery" }).click();
    await expect(card).toBeVisible();
    await filter.getByRole("button", { name: "Todos" }).click();

    // Accepting a delivery asks for the arrival time.
    await card.getByRole("button", { name: "Aceptar" }).click();
    const acceptDialog = board.getByRole("dialog", { name: /Aceptar pedido #/ });
    await expect(acceptDialog.getByRole("radio", { name: "90 min" })).toBeVisible();
    await acceptDialog.getByRole("radio", { name: "30 min" }).click();
    await expect(acceptDialog).toContainText(/Llega aprox\. a las \d{2}:\d{2}/);
    await acceptDialog.getByRole("button", { name: "Aceptar pedido" }).click();
    await expect(acceptDialog).toHaveCount(0);
    const accepted = board.getByTestId("column-accepted").locator('[data-channel="delivery"]').filter({ hasText: "Rita" });
    await expect(accepted.getByTestId("ready-at")).toHaveText(/^Llega aprox\. \d{2}:\d{2}$/);
    const arrival = ((await accepted.getByTestId("ready-at").textContent()) ?? "").match(/\d{2}:\d{2}/)?.[0];
    expect(arrival).toBeTruthy();
    await expect(phone.getByTestId("order-status")).toHaveText("Aceptado");
    await expect(phone.getByTestId("ready-at")).toHaveText(`Llega aprox. a las ${arrival}`);

    // Assign the rider.
    await accepted.getByRole("button", { name: "Asignar repartidor" }).click();
    const riderDialog = board.getByRole("dialog", { name: /Repartidor del pedido #/ });
    await riderDialog.getByRole("button", { name: RIDER_NAME }).click();
    await expect(riderDialog).toHaveCount(0);
    await expect(accepted.getByTestId("order-rider")).toContainText(`Repartidor: ${RIDER_NAME}`);
    await screenshot(board, "delivery-board");

    // Kitchen flow: Empezar → Listo.
    await accepted.getByRole("button", { name: "Empezar" }).click();
    const preparing = board.getByTestId("column-preparing").locator('[data-channel="delivery"]').filter({ hasText: "Rita" });
    await preparing.getByRole("button", { name: "Listo" }).click();
    await expect(board.getByTestId("column-ready").locator('[data-channel="delivery"]').filter({ hasText: "Rita" })).toBeVisible();
    await expect(phone.getByTestId("order-status")).toHaveText("Listo");

    // The rider (rider role only) lands on "Repartos" from the restaurant list and sees only their delivery.
    const riderPage = await rider.newPage();
    await riderPage.goto("/admin");
    await riderPage.getByRole("link", { name: new RegExp(restaurantName) }).click();
    await expect(riderPage).toHaveURL(new RegExp(`/admin/${shared.restaurantId}/repartos$`));
    await expect(riderPage.getByRole("link", { name: "Pedidos" })).toHaveCount(0);
    await expect(riderPage.getByTestId("live-badge")).toHaveText("En vivo");
    const delivery = riderPage.getByTestId("delivery-card").filter({ hasText: "Rita" });
    await expect(delivery.getByTestId("delivery-address")).toContainText("Av. Italia 1234, Depto 402");
    await expect(delivery.getByTestId("rider-change")).toHaveText("Llevar vuelto: $9.010");
    await expect(delivery.getByRole("link", { name: /\+56 9 8765 4321/ })).toHaveAttribute("href", "tel:+56987654321");
    await screenshot(riderPage, "delivery-rider");

    // Out for delivery: the customer sees the rider's first name.
    await delivery.getByRole("button", { name: "Salir a repartir" }).click();
    await expect(delivery.getByTestId("delivery-status")).toHaveText("En reparto");
    await expect(phone.getByTestId("order-status")).toHaveText("En reparto");
    await expect(phone.getByTestId("on-the-way")).toHaveText("Rodrigo va en camino");
    await expect(board.getByTestId("column-out_for_delivery").locator('[data-channel="delivery"]').filter({ hasText: "Rita" })).toBeVisible();
    await screenshot(phone, "delivery-tracking-on-the-way");

    // Delivered unpaid: the rider is asked how it was paid (cash first, as announced).
    await delivery.getByRole("button", { name: "Entregado" }).click();
    const collect = riderPage.getByRole("dialog", { name: /sin pagar/ });
    await expect(collect.getByTestId("handover-expected-payment")).toContainText("vuelto $9.010");
    await expect(collect.getByRole("button", { name: "Ya estaba pagado · solo entregar" })).toBeVisible();
    await collect.getByRole("button", { name: "Efectivo y entregar" }).click();
    await expect(collect).toHaveCount(0);
    await expect(delivery).toHaveCount(0);
    await expect(riderPage.getByText("No tienes repartos asignados.", { exact: false })).toBeVisible();

    await expect(phone.getByTestId("order-status")).toHaveText("Entregado");
    await expect(phone.getByTestId("ready-at")).toHaveCount(0);

    // The board drops it; "Hoy" keeps it as paid in cash.
    await expect(board.locator('[data-testid="order-card"][data-channel="delivery"]').filter({ hasText: "Rita" })).toHaveCount(0);
    await board.getByRole("tab", { name: "Hoy" }).click();
    const row = board.getByRole("list", { name: "Pedidos de hoy" }).getByTestId("today-row").filter({ hasText: "Rita" });
    await expect(row).toContainText("Delivery · Ñuñoa");
    await expect(row).toContainText("Entregado");
    await expect(row).toContainText("Pagado · Efectivo");
    await expect(row).toContainText("$10.990");
  } finally {
    await owner.close();
    await customer.close();
    await rider.close();
  }
});
