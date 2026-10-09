import { type APIRequestContext, type BrowserContext, expect, type Page, test } from "@playwright/test";
import { CONTEXT_OPTIONS, ORIGIN_HEADER, registerViaApi, runId, uniqueEmail, verifyEmailViaApi } from "./helpers";

/*
 * Phase 7: maps. Runs last (file order) and registers 1 user (the owner, who also takes the rider role so
 * the spec needs no second registration).
 * - Without map data (`map-config.available` false, e.g. before `pnpm maps:init`) the delivery checkout
 *   keeps working with the zone list. This test also covers zones without an area when the map exists.
 * - With map data: a zone drawn on the map, the customer's pin from simulated geolocation (outside → warning,
 *   inside → zone chosen, order carries the pin), and the rider's position reaching the tracking page.
 */
test.describe.configure({ mode: "serial", timeout: 300_000 });

const id = runId();
const ownerEmail = uniqueEmail("maps-owner");
const restaurantName = `Mapas ${id}`;
const ZONE = "Centro";

/** A square of ~2 km around Plaza de Armas; INSIDE is its center, OUTSIDE is in Maipú. */
const INSIDE = { latitude: -33.4378, longitude: -70.6504 };
const OUTSIDE = { latitude: -33.5106, longitude: -70.7572 };
const HALF = 0.01;
const AREA = [
  { lat: INSIDE.latitude - HALF, lng: INSIDE.longitude - HALF },
  { lat: INSIDE.latitude - HALF, lng: INSIDE.longitude + HALF },
  { lat: INSIDE.latitude + HALF, lng: INSIDE.longitude + HALF },
  { lat: INSIDE.latitude + HALF, lng: INSIDE.longitude - HALF },
];

/** Filled by the setup. */
const shared = { restaurantId: "", slug: "", zoneId: "", ownerId: "", mapAvailable: false };

async function send(api: APIRequestContext, method: "get" | "post" | "patch" | "put", path: string, data?: unknown, status = 200) {
  const response = await api[method](path, method === "get" ? {} : { data, headers: ORIGIN_HEADER });
  expect(response.status(), await response.text()).toBe(status);
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as Record<string, unknown>;
}

/** Owner, open restaurant with delivery on, one product of $4.500 and one zone by name (no area). */
async function setup(owner: BrowserContext): Promise<void> {
  const api = owner.request;
  await registerViaApi(api, { name: "Marta Mapas", email: ownerEmail });
  await verifyEmailViaApi(api, ownerEmail);
  const me = await send(api, "get", "/api/auth/me");
  shared.ownerId = String(me.id);
  const restaurant = await send(api, "post", "/api/restaurants", { name: restaurantName }, 201);
  shared.restaurantId = String(restaurant.id);
  shared.slug = String(restaurant.slug);
  const base = `/api/restaurants/${shared.restaurantId}`;
  await send(api, "patch", base, { phone: "+56 2 2345 6789", deliveryEnabled: true });
  await send(api, "put", `${base}/accepting-orders`, { acceptingOrders: true });
  const category = await send(api, "post", `${base}/menu/categories`, { name: "Pizzas", description: "" }, 201);
  await send(
    api,
    "post",
    `${base}/menu/products`,
    { categoryId: category.id, name: "Margarita", description: "", price: 4500, visible: true, modifierGroupIds: [] },
    201,
  );
  const zone = await send(api, "post", `${base}/delivery-zones`, { name: ZONE, fee: 0, minOrder: 0, isHome: true }, 201);
  shared.zoneId = String(zone.id);
  const config = await send(api, "get", "/api/public/map-config");
  shared.mapAvailable = config.available === true;
}

/** Customer: one Margarita in the cart and the checkout open. */
async function openCheckout(page: Page) {
  await page.goto(`/r/${shared.slug}`);
  await page.getByTestId("public-product").filter({ hasText: "Margarita" }).click();
  await page.getByRole("dialog", { name: "Margarita" }).getByRole("button", { name: "Agregar $4.500" }).click();
  await page.getByRole("button", { name: /Ver pedido \(1\)/ }).click();
  return page.getByRole("dialog", { name: "Tu pedido" });
}

async function fillContact(cart: ReturnType<Page["getByRole"]>, name: string) {
  await cart.getByLabel("Tu nombre").fill(name);
  await cart.getByLabel("Teléfono").fill("9 8765 4321");
  await cart.getByLabel("Calle y número").fill("Bandera 123");
  await cart.getByRole("radio", { name: "Efectivo" }).check();
}

let owner: BrowserContext;

test.beforeAll(async ({ browser }) => {
  // The owner's phone is also the rider's: geolocation granted, near the destination.
  owner = await browser.newContext({
    ...CONTEXT_OPTIONS,
    permissions: ["geolocation"],
    geolocation: { latitude: INSIDE.latitude + 0.004, longitude: INSIDE.longitude },
  });
  await setup(owner);
});

test.afterAll(async () => {
  await owner?.close();
});

test("delivery checkout works with the zone list when no zone is drawn (or there is no map)", async ({ browser }) => {
  const customer = await browser.newContext(CONTEXT_OPTIONS);
  try {
    const page = await customer.newPage();
    const cart = await openCheckout(page);
    // No drawn zone: no map and no pin requirement, the zone comes preselected by name.
    await expect(cart.getByLabel("Comuna o zona").locator("option:checked")).toHaveText(new RegExp(`^${ZONE}`));
    await expect(cart.getByTestId("delivery-pin")).toHaveCount(0);
    await expect(cart.getByTestId("pin-required")).toHaveCount(0);
    await fillContact(cart, "Lista Sinmapa");
    await cart.getByRole("button", { name: /Pedir delivery/ }).click();
    await expect(page).toHaveURL(/\/pedido#t=[A-Za-z0-9_-]{20,}$/);
    await expect(page.getByTestId("order-status")).toHaveText("Pendiente");
    await expect(page.getByTestId("delivery-address")).toContainText("Bandera 123");
  } finally {
    await customer.close();
  }

  // The owner's settings explain the missing map (only when there is none) and never block the zones.
  const settings = await owner.newPage();
  await settings.goto(`/admin/${shared.restaurantId}`);
  await expect(settings.getByRole("list", { name: "Zonas de reparto" }).getByTestId("zone-row")).toHaveCount(1);
  if (shared.mapAvailable) {
    await expect(settings.getByRole("button", { name: `Dibujar en el mapa de ${ZONE}` })).toBeVisible();
    await expect(settings.getByTestId("map-unavailable")).toHaveCount(0);
  } else {
    await expect(settings.getByTestId("map-unavailable").first()).toContainText("pnpm maps:init");
    await expect(settings.getByRole("button", { name: /Dibujar en el mapa/ })).toHaveCount(0);
  }
  await settings.close();
});

test("with the map: drawn zone, pin from geolocation, and the rider followed live", async ({ browser }) => {
  test.skip(!shared.mapAvailable, "map-config.available is false: load the map data with `pnpm maps:init`");
  const base = `/api/restaurants/${shared.restaurantId}`;

  // The owner draws the zone and places the restaurant (through the api; the editor is checked below).
  await send(owner.request, "patch", `${base}/delivery-zones/${shared.zoneId}`, { area: AREA });
  await send(owner.request, "patch", base, { location: { lat: INSIDE.latitude, lng: INSIDE.longitude } });
  // A self-crossing shape is refused.
  const bowTie = [AREA[0], AREA[2], AREA[1], AREA[3]];
  const crossed = await owner.request.patch(`${base}/delivery-zones/${shared.zoneId}`, { data: { area: bowTie }, headers: ORIGIN_HEADER });
  expect(crossed.status()).toBe(400);
  expect((await crossed.json()).code).toBe("INVALID_ZONE_AREA");

  const settings = await owner.newPage();
  await settings.goto(`/admin/${shared.restaurantId}`);
  const row = settings.getByRole("list", { name: "Zonas de reparto" }).getByTestId("zone-row").filter({ hasText: ZONE });
  await expect(row.getByTestId("zone-area-badge")).toHaveText("En el mapa");
  await row.getByRole("button", { name: `Editar área de ${ZONE}` }).click();
  const editor = settings.getByRole("dialog", { name: `Área de reparto · ${ZONE}` });
  await expect(editor.getByRole("region", { name: `Mapa para dibujar el área de ${ZONE}` })).toBeVisible();
  await expect(editor.getByTestId("area-vertices")).toHaveText("4 puntos");
  await editor.getByRole("button", { name: "Limpiar" }).click();
  await expect(editor.getByTestId("area-vertices")).toHaveText("0 puntos");
  await expect(editor.getByRole("button", { name: "Guardar área" })).toBeDisabled();
  await editor.getByRole("button", { name: "Deshacer" }).click();
  await expect(editor.getByTestId("area-vertices")).toHaveText("4 puntos");
  await editor.getByRole("button", { name: "Cancelar" }).click();
  await expect(settings.getByTestId("restaurant-location")).toContainText("Tu local está ubicado en el mapa");
  await settings.close();

  // The customer starts away from the delivery area.
  const customer = await browser.newContext({
    ...CONTEXT_OPTIONS,
    permissions: ["geolocation"],
    geolocation: OUTSIDE,
  });
  try {
    const phone = await customer.newPage();
    const cart = await openCheckout(phone);
    await expect(cart.getByRole("region", { name: "Mapa para marcar dónde entregar" })).toBeVisible();
    // The drawn zone needs a pin: the order cannot be sent yet.
    await expect(cart.getByTestId("pin-required")).toContainText(`Para ${ZONE} necesitamos tu ubicación`);
    await fillContact(cart, "Pina Mapa");
    await expect(cart.getByRole("button", { name: /Pedir delivery/ })).toBeDisabled();

    await cart.getByRole("button", { name: "Usar mi ubicación" }).click();
    await expect(cart.getByTestId("pin-outside")).toContainText("El local no reparte ahí.");
    await expect(cart.getByTestId("pin-required")).toContainText("fuera de");

    // At the right place: the zone is chosen by the pin.
    await customer.setGeolocation(INSIDE);
    await cart.getByRole("button", { name: "Usar mi ubicación" }).click();
    await expect(cart.getByTestId("pin-zone")).toHaveText(`Entregamos en ${ZONE}`);
    await expect(cart.getByTestId("pin-required")).toHaveCount(0);
    await cart.getByRole("button", { name: /Pedir delivery/ }).click();
    await expect(phone).toHaveURL(/\/pedido#t=[A-Za-z0-9_-]{20,}$/);
    await expect(phone.getByTestId("order-status")).toHaveText("Pendiente");

    // The order carries the pin.
    const orders = (await send(owner.request, "get", `${base}/orders?scope=active`)) as unknown as Array<{
      id: string;
      customerName: string;
      delivery: { location: { lat: number; lng: number } | null } | null;
    }>;
    const order = orders.find((o) => o.customerName === "Pina Mapa");
    expect(order?.delivery?.location).toEqual({ lat: INSIDE.latitude, lng: INSIDE.longitude });
    const orderId = order!.id;

    // The owner rides it: rider role, accepted → ready, assigned to themself, paid in advance.
    await send(owner.request, "patch", `${base}/members/${shared.ownerId}`, { roles: ["owner", "rider"] }, 204);
    await send(owner.request, "post", `${base}/orders/${orderId}/status`, { status: "accepted", readyInMinutes: 30 });
    await send(owner.request, "post", `${base}/orders/${orderId}/status`, { status: "preparing" });
    await send(owner.request, "post", `${base}/orders/${orderId}/status`, { status: "ready" });
    await send(owner.request, "put", `${base}/orders/${orderId}/rider`, { riderId: shared.ownerId });
    await send(owner.request, "post", `${base}/orders/${orderId}/payment`, { method: "cash" });

    const riderPage = await owner.newPage();
    await riderPage.goto(`/admin/${shared.restaurantId}/repartos`);
    await expect(riderPage.getByTestId("live-badge")).toHaveText("En vivo");
    const card = riderPage.getByTestId("delivery-card").filter({ hasText: "Pina Mapa" });
    await expect(card.getByTestId("rider-navigate")).toHaveAttribute(
      "href",
      `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${INSIDE.latitude},${INSIDE.longitude}`)}`,
    );
    await card.getByRole("button", { name: "Salir a repartir" }).click();
    await expect(card.getByTestId("delivery-status")).toHaveText("En reparto");
    await expect(riderPage.getByTestId("location-sharing")).toContainText("Compartiendo tu ubicación · mantén la pantalla encendida");
    await expect(card.getByRole("region", { name: /Mapa del reparto #/ })).toBeVisible();

    // The customer sees the rider on the map, live.
    await expect(phone.getByTestId("order-status")).toHaveText("En reparto");
    await expect(phone.getByRole("region", { name: "Mapa con el repartidor y tu dirección" })).toBeVisible();
    await expect(phone.getByTestId("rider-updated")).toContainText(/Actualizado|en vivo/, { timeout: 20_000 });
    await expect(phone.getByTestId("rider-waiting")).toHaveCount(0);

    // Delivered: sharing stops and the map goes away.
    await card.getByRole("button", { name: "Entregado" }).click();
    await expect(riderPage.getByTestId("location-sharing")).toHaveCount(0);
    await expect(phone.getByTestId("order-status")).toHaveText("Entregado");
    await expect(phone.getByTestId("rider-tracking")).toHaveCount(0);
    const position = await send(owner.request, "get", `${base}/orders/${orderId}/rider-location`);
    expect(position.position).toBeNull();
    await riderPage.close();
  } finally {
    await customer.close();
  }
});
