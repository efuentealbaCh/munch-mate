import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type APIRequestContext, type BrowserContext, expect, type Locator, type Page, test } from "@playwright/test";
import { CONTEXT_OPTIONS, ORIGIN_HEADER, waitForEmailLink, waitForHydration } from "../e2e/helpers";

/*
 * Delivery with live rider tracking, step by step, on the demo data (Pizzería Forno Rosso). Saves one
 * screenshot per step in docs/capturas/delivery/ plus capturas.json (step, actor, caption), used by the
 * test guide. Three phones: the customer (guest), the owner (demo account) and the rider (an account invited
 * with the rider role; created on the first run, reused afterwards).
 */
test.describe.configure({ mode: "serial" });

const OUT = resolve(__dirname, "../../../docs/capturas/delivery");
const SLUG = "pizzeria-forno-rosso";
const RESTAURANT = "Pizzería Forno Rosso";
const DEMO = { email: "demo@munchmate.local", password: "munchmate demo 2026" };
const RIDER = { email: "repartidor@munchmate.local", password: "munchmate demo 2026", name: "Rodrigo Reparto" };
const CUSTOMER = "Rita Ñuñoa";

/** The restaurant (demo location), the customer's door (inside the Ñuñoa zone) and the rider's way there. */
const SHOP = { latitude: -33.4566, longitude: -70.5978 };
const HOME = { latitude: -33.4645, longitude: -70.608 };
const ROUTE = [0.25, 0.5, 0.8].map((t) => ({
  latitude: SHOP.latitude + (HOME.latitude - SHOP.latitude) * t,
  longitude: SHOP.longitude + (HOME.longitude - SHOP.longitude) * t,
}));

const shots: Array<{ file: string; actor: string; caption: string }> = [];

async function shot(page: Page, actor: string, name: string, caption: string, focus?: Locator) {
  if (focus) await focus.evaluate((element) => element.scrollIntoView({ block: "center" }));
  await waitForMaps(page);
  // Let fonts and transitions settle.
  await page.waitForTimeout(focus ? 600 : 400);
  const file = `${String(shots.length + 1).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path: join(OUT, file) });
  shots.push({ file, actor, caption });
  writeFileSync(join(OUT, "capturas.json"), `${JSON.stringify(shots, null, 2)}\n`);
}

/**
 * When the page shows maps, waits until they are drawn: the map box has a real size, the tile requests have
 * finished, and a short pause lets MapLibre paint the last tiles and markers.
 */
async function waitForMaps(page: Page) {
  const maps = page.locator(".maplibregl-map");
  if ((await maps.count()) === 0) return;
  await expect
    .poll(() => maps.evaluateAll((all) => all.every((m) => m.getBoundingClientRect().height > 50)), {
      message: "the map box has no height (it would be captured blank)",
    })
    .toBe(true);
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  // Drawn tiles: a blank map compresses to a few KB, streets and labels to tens of KB.
  for (const map of await maps.all()) {
    if (!(await map.isVisible())) continue;
    await expect
      .poll(async () => (await map.screenshot()).length, {
        message: "the map tiles were never drawn",
        timeout: 30_000,
        intervals: [500],
      })
      .toBeGreaterThan(MIN_DRAWN_MAP_BYTES);
  }
  await page.waitForTimeout(1_000);
}

/** PNG size above which a map screenshot has streets on it (a solid grey box is ~5 KB). */
const MIN_DRAWN_MAP_BYTES = 30_000;

async function call(api: APIRequestContext, method: "get" | "post", path: string, data?: unknown) {
  const response = await api[method](path, method === "get" ? {} : { data, headers: ORIGIN_HEADER });
  const text = await response.text();
  return { status: response.status(), body: (text ? JSON.parse(text) : null) as unknown };
}

async function login(context: BrowserContext, user: { email: string; password: string }): Promise<boolean> {
  // Only these two fields: the api rejects unknown ones.
  const { status } = await call(context.request, "post", "/api/auth/login", { email: user.email, password: user.password });
  return status === 200 || status === 201;
}

/** Rider account with the rider role in the pizzeria: invited by the owner, reused on later runs. */
async function ensureRider(owner: BrowserContext, rider: BrowserContext, restaurantId: string) {
  if (!(await login(rider, RIDER))) {
    const created = await call(rider.request, "post", "/api/auth/register", { ...RIDER });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
  }
  const riders = (await call(owner.request, "get", `/api/restaurants/${restaurantId}/riders`)).body as Array<{ name: string }>;
  if (riders.some((r) => r.name === RIDER.name)) return;
  const invite = await call(owner.request, "post", `/api/restaurants/${restaurantId}/invitations`, {
    email: RIDER.email,
    roles: ["rider"],
  });
  expect(invite.status, JSON.stringify(invite.body)).toBe(201);
  const link = await waitForEmailLink(RIDER.email, "/invitacion");
  const token = new URL(link, "https://placeholder").searchParams.get("token");
  const accepted = await call(rider.request, "post", "/api/invitations/accept", { token });
  expect(accepted.status, JSON.stringify(accepted.body)).toBeLessThan(300);
}

test("delivery con seguimiento del repartidor, paso a paso", async ({ browser }) => {
  mkdirSync(OUT, { recursive: true });
  const owner = await browser.newContext(CONTEXT_OPTIONS);
  const customer = await browser.newContext({ ...CONTEXT_OPTIONS, permissions: ["geolocation"], geolocation: HOME });
  const rider = await browser.newContext({ ...CONTEXT_OPTIONS, permissions: ["geolocation"], geolocation: SHOP });
  try {
    expect(await login(owner, DEMO), "run `pnpm seed:demo` first").toBe(true);
    const restaurants = (await call(owner.request, "get", "/api/restaurants")).body as Array<{ id: string; name: string }>;
    const restaurantId = restaurants.find((r) => r.name === RESTAURANT)?.id;
    expect(restaurantId, "run `pnpm seed:demo` first").toBeTruthy();
    const mapConfig = (await call(owner.request, "get", "/api/public/map-config")).body as { available: boolean };
    expect(mapConfig.available, "load the map with `pnpm maps:init`").toBe(true);
    await ensureRider(owner, rider, restaurantId!);

    // The owner keeps the live board open.
    const board = await owner.newPage();
    await board.goto(`/admin/${restaurantId}/pedidos`);
    await expect(board.getByTestId("live-badge")).toHaveText("En vivo");

    // 1. Customer: public menu, a pizza with its required options and a drink.
    const phone = await customer.newPage();
    await phone.goto(`/r/${SLUG}`);
    await waitForHydration(phone);
    await expect(phone.getByTestId("pickup-banner")).toBeVisible();
    await shot(phone, "Cliente", "menu-publico", "Abre el menú público del local. El aviso confirma que hay retiro y delivery.");

    await phone.getByTestId("public-product").filter({ hasText: "Margarita" }).click();
    const pizza = phone.getByRole("dialog", { name: "Margarita" });
    await pizza.getByRole("radio", { name: /Familiar/ }).check();
    await pizza.getByRole("radio", { name: /Tradicional/ }).check();
    await shot(phone, "Cliente", "producto-opciones", "Elige las opciones obligatorias (tamaño y masa). El precio del botón se actualiza.");
    await pizza.getByRole("button", { name: /^Agregar \$/ }).click();
    await phone.getByTestId("public-product").filter({ hasText: "Bebida 1,5 L" }).click();
    const drink = phone.getByRole("dialog", { name: "Bebida 1,5 L" });
    // Its flavour is a required choice: take the first one.
    await drink.getByRole("radio").first().check();
    await drink.getByRole("button", { name: /^Agregar \$/ }).click();

    // 2. Checkout: delivery, pin on the map, contact and cash with change.
    await phone.getByRole("button", { name: /Ver pedido \(2\)/ }).click();
    const cart = phone.getByRole("dialog", { name: "Tu pedido" });
    const channel = cart.getByRole("radiogroup", { name: "¿Cómo quieres recibirlo?" });
    if (await channel.count()) await channel.getByRole("radio", { name: /Delivery/ }).check();
    await expect(cart.getByRole("region", { name: "Mapa para marcar dónde entregar" })).toBeVisible();
    await cart.getByRole("button", { name: "Usar mi ubicación" }).click();
    await expect(cart.getByTestId("pin-zone")).toHaveText("Entregamos en Ñuñoa");
    await shot(
      phone,
      "Cliente",
      "checkout-mapa",
      "Elige Delivery y toca «Usar mi ubicación». El pin elige la zona solo (Ñuñoa) y suma su costo de envío.",
      cart.getByTestId("pin-zone"),
    );

    await cart.getByLabel("Tu nombre").fill(CUSTOMER);
    await cart.getByLabel("Teléfono").fill("9 8765 4321");
    await cart.getByLabel("Calle y número").fill("Av. Italia 1234");
    await cart.getByLabel("Depto, casa u oficina (opcional)").fill("Depto 402");
    await cart.getByLabel("Referencia (opcional)").fill("Portón verde");
    await cart.getByRole("radio", { name: "Efectivo" }).check();
    await cart.getByLabel("¿Con cuánto pagas? (opcional)").fill("20.000");
    await expect(cart.getByTestId("cash-change")).toContainText("Tu vuelto");
    await shot(
      phone,
      "Cliente",
      "checkout-pago",
      "Completa nombre, teléfono y dirección. Con efectivo, indica con cuánto pagas y ves tu vuelto.",
      cart.getByTestId("cash-change"),
    );
    await cart.getByRole("button", { name: /Pedir delivery/ }).click();
    await expect(phone).toHaveURL(/\/pedido#t=[A-Za-z0-9_-]{20,}$/);
    await expect(phone.getByTestId("order-status")).toHaveText("Pendiente");
    await shot(phone, "Cliente", "seguimiento-pendiente", "Llega a la página de seguimiento: número de pedido y estado «Pendiente». Guarda este link.");

    // 3. Owner: the order appears live; accept with an arrival time and assign the rider.
    const card = board.locator('[data-testid="order-card"][data-channel="delivery"]').filter({ hasText: CUSTOMER }).first();
    await expect(card).toBeVisible();
    await shot(board, "Dueño / caja", "tablero-pedido-nuevo", "El pedido aparece en el tablero sin recargar, con dirección, zona y el vuelto que hay que llevar.", card);

    await card.getByRole("button", { name: "Aceptar" }).click();
    const acceptDialog = board.getByRole("dialog", { name: /Aceptar pedido #/ });
    await acceptDialog.getByRole("radio", { name: "30 min" }).click();
    await expect(acceptDialog).toContainText(/Llega aprox\. a las \d{2}:\d{2}/);
    await shot(board, "Dueño / caja", "aceptar-hora-llegada", "Al aceptar, elige en cuánto llega. La hora estimada se calcula sola.");
    await acceptDialog.getByRole("button", { name: "Aceptar pedido" }).click();
    await expect(acceptDialog).toHaveCount(0);
    await expect(phone.getByTestId("order-status")).toHaveText("Aceptado");
    await shot(phone, "Cliente", "seguimiento-aceptado", "El cliente ve «Aceptado» y la hora aproximada de llegada, en vivo.");

    const accepted = board.getByTestId("column-accepted").locator('[data-channel="delivery"]').filter({ hasText: CUSTOMER }).first();
    await accepted.getByRole("button", { name: "Asignar repartidor" }).click();
    const riderDialog = board.getByRole("dialog", { name: /Repartidor del pedido #/ });
    await shot(board, "Dueño / caja", "asignar-repartidor", "«Asignar repartidor» lista a los miembros con el rol Repartidor.");
    await riderDialog.getByRole("button", { name: RIDER.name }).click();
    await expect(riderDialog).toHaveCount(0);
    await expect(accepted.getByTestId("order-rider")).toContainText(RIDER.name);

    await accepted.getByRole("button", { name: "Empezar" }).click();
    const preparing = board.getByTestId("column-preparing").locator('[data-channel="delivery"]').filter({ hasText: CUSTOMER }).first();
    await preparing.getByRole("button", { name: "Listo" }).click();
    await expect(phone.getByTestId("order-status")).toHaveText("Listo");

    // 4. Rider: only their deliveries; takes it out and shares the location.
    const riderPage = await rider.newPage();
    await riderPage.goto("/admin");
    await riderPage.getByRole("link", { name: new RegExp(RESTAURANT) }).click();
    await expect(riderPage).toHaveURL(/\/repartos$/);
    await expect(riderPage.getByTestId("live-badge")).toHaveText("En vivo");
    const delivery = riderPage.getByTestId("delivery-card").filter({ hasText: CUSTOMER }).first();
    await expect(delivery.getByTestId("rider-change")).toContainText("Llevar vuelto");
    await shot(riderPage, "Repartidor", "repartidor-mis-repartos", "El repartidor solo ve sus entregas: dirección, teléfono, cómo navegar y el vuelto que debe llevar.", delivery);

    await delivery.getByRole("button", { name: "Salir a repartir" }).click();
    await expect(delivery.getByTestId("delivery-status")).toHaveText("En reparto");
    await expect(riderPage.getByTestId("location-sharing")).toContainText("Compartiendo tu ubicación");
    await expect(delivery.getByRole("region", { name: /Mapa del reparto #/ })).toBeVisible();
    await shot(
      riderPage,
      "Repartidor",
      "repartidor-en-reparto",
      "«Salir a repartir»: el teléfono empieza a compartir su ubicación. Debe mantener la pantalla encendida.",
      riderPage.getByTestId("location-sharing"),
    );
    await shot(
      riderPage,
      "Repartidor",
      "repartidor-mapa",
      "Más abajo, en la misma tarjeta, el repartidor ve en el mapa su posición (punto azul) y la dirección de entrega.",
      delivery.getByRole("region", { name: /Mapa del reparto #/ }),
    );

    // 5. Customer follows the rider; the rider moves (a report every 3 s at most is kept).
    await expect(phone.getByTestId("order-status")).toHaveText("En reparto");
    const tracking = phone.getByRole("region", { name: "Mapa con el repartidor y tu dirección" });
    await expect(tracking).toBeVisible();
    await expect(phone.getByTestId("rider-updated")).toContainText(/Actualizado|en vivo/, { timeout: 20_000 });
    await shot(phone, "Cliente", "seguimiento-en-reparto", "El cliente ve «En reparto» y el mapa con el repartidor (saliendo del local) y su dirección.", phone.getByTestId("rider-tracking"));

    for (const point of ROUTE) {
      await riderPage.waitForTimeout(3_500);
      await rider.setGeolocation(point);
    }
    await phone.waitForTimeout(4_000);
    await shot(phone, "Cliente", "seguimiento-acercandose", "Unos segundos después, el repartidor se movió en el mapa hacia la dirección del cliente.", phone.getByTestId("rider-tracking"));

    await board.bringToFront();
    const out = board.getByTestId("column-out_for_delivery").locator('[data-channel="delivery"]').filter({ hasText: CUSTOMER }).first();
    await out.getByTestId("track-rider").click();
    const dialog = board.getByRole("dialog");
    // The map loads on demand: wait until it exists before waitForMaps() looks for it.
    await expect(dialog.locator(".maplibregl-map")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Ver ambos" })).toBeVisible();
    await shot(board, "Dueño / caja", "tablero-mapa-repartidor", "Desde el tablero, «Seguir al repartidor» abre el mismo mapa en vivo para el local.");
    await board.keyboard.press("Escape");

    // 6. Delivered: collect the cash, the tracking stops.
    await riderPage.bringToFront();
    await delivery.getByRole("button", { name: "Entregado" }).click();
    const collect = riderPage.getByRole("dialog", { name: /sin pagar/ });
    await expect(collect.getByTestId("handover-expected-payment")).toContainText("vuelto");
    await shot(riderPage, "Repartidor", "repartidor-cobrar", "«Entregado» en un pedido sin pagar pide registrar el cobro (con el vuelto a la vista).");
    await collect.getByRole("button", { name: "Efectivo y entregar" }).click();
    await expect(collect).toHaveCount(0);
    await expect(riderPage.getByTestId("location-sharing")).toHaveCount(0);

    await expect(phone.getByTestId("order-status")).toHaveText("Entregado");
    await expect(phone.getByTestId("rider-tracking")).toHaveCount(0);
    await shot(phone, "Cliente", "seguimiento-entregado", "El cliente ve «Entregado»: el mapa desaparece y la ubicación del repartidor se borra.");

    await board.getByRole("tab", { name: "Hoy" }).click();
    const row = board.getByRole("list", { name: "Pedidos de hoy" }).getByTestId("today-row").filter({ hasText: CUSTOMER }).first();
    await expect(row).toContainText("Entregado");
    await expect(row).toContainText("Pagado · Efectivo");
    await shot(board, "Dueño / caja", "tablero-hoy", "En la pestaña «Hoy» del tablero el pedido queda Entregado y Pagado · Efectivo.", row);
  } finally {
    await owner.close();
    await customer.close();
    await rider.close();
  }
});
