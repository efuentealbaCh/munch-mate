import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { type Browser, type BrowserContext, expect, type Page, test } from "@playwright/test";
import { CONTEXT_OPTIONS, ORIGIN_HEADER, waitForHydration } from "../e2e/helpers";

/*
 * Screens for a product showcase (portfolio), on the demo data (Pizzería Forno Rosso): the owner's desktop
 * screens at 1920×960 (16:8) and the phone screens of the features added after the delivery and floor guides
 * (editing an order, splitting a bill). Leaves orders behind on purpose. No print agent involved.
 * Saves docs/capturas/portafolio/*.png (or PORTAFOLIO_OUT). Run with:
 *   pnpm --filter @app/web exec playwright test --config playwright.guide.config.ts portafolio
 */
test.describe.configure({ mode: "serial" });

const OUT = resolve(process.env.PORTAFOLIO_OUT ?? resolve(__dirname, "../../../docs/capturas/portafolio"));
const SLUG = "pizzeria-forno-rosso";
const RESTAURANT = "Pizzería Forno Rosso";
const DEMO = { email: "demo@munchmate.local", password: "munchmate demo 2026" };
const DESKTOP = {
  baseURL: CONTEXT_OPTIONS.baseURL,
  ignoreHTTPSErrors: true,
  locale: "es-CL",
  timezoneId: "America/Santiago",
  // 1440×720 CSS pixels at 4/3 = 1920×960 files (16:8): the admin is max-width, so a narrower window fills more.
  viewport: { width: 1440, height: 720 },
  deviceScaleFactor: 4 / 3,
};

interface MenuGroup {
  id: string;
  minSelect: number;
  options: { id: string; available: boolean }[];
}
interface MenuProduct {
  id: string;
  name: string;
  available: boolean;
  modifierGroups: MenuGroup[];
}

let products: MenuProduct[] = [];
let restaurantId = "";
let tables: { label: string; token: string }[] = [];

async function shot(page: Page, name: string) {
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
}

async function send(context: BrowserContext, method: "get" | "post" | "put", path: string, data?: unknown) {
  const response =
    method === "get" ? await context.request.get(path) : await context.request[method](path, { data, headers: ORIGIN_HEADER });
  const text = await response.text();
  expect(response.ok(), `${method} ${path} → ${response.status()} ${text}`).toBeTruthy();
  return (text ? JSON.parse(text) : null) as unknown;
}

/** One unit of a product, with the first available option of every required group. */
function item(name: string, quantity = 1) {
  const product = products.find((p) => p.name === name);
  if (!product) throw new Error(`No product ${name} in the demo menu`);
  const modifiers = product.modifierGroups
    .filter((group) => group.minSelect > 0)
    .map((group) => ({ groupId: group.id, optionIds: group.options.filter((o) => o.available).slice(0, group.minSelect).map((o) => o.id) }));
  return { productId: product.id, quantity, modifiers };
}

async function tableOrder(context: BrowserContext, label: string, items: ReturnType<typeof item>[]) {
  const table = tables.find((t) => t.label === label);
  if (!table) throw new Error(`No table ${label}`);
  return (await send(context, "post", `/api/public/tables/${table.token}/orders`, { clientOrderId: crypto.randomUUID(), items })) as {
    accessToken: string;
    order: { number: number };
  };
}

async function pickupOrder(context: BrowserContext, name: string, phone: string, items: ReturnType<typeof item>[]) {
  return send(context, "post", `/api/public/restaurants/${SLUG}/orders`, {
    clientOrderId: crypto.randomUUID(),
    items,
    customerName: name,
    customerPhone: phone,
  });
}

/** Moves the owner's active orders matching `filter` to `status`, through every intermediate state. */
async function advance(owner: BrowserContext, match: (order: { tableLabel: string | null; customerName: string }) => boolean, to: string) {
  const path = ["pending", "accepted", "preparing", "ready", "served"];
  const orders = (await send(owner, "get", `/api/restaurants/${restaurantId}/orders`)) as {
    id: string;
    status: string;
    channel: string;
    tableLabel: string | null;
    customerName: string;
  }[];
  for (const order of orders.filter(match)) {
    const last = order.channel === "pickup" ? path.indexOf(to === "served" ? "ready" : to) : path.indexOf(to);
    for (let i = path.indexOf(order.status) + 1; i <= last; i++) {
      const status = path[i];
      await send(owner, "post", `/api/restaurants/${restaurantId}/orders/${order.id}/status`, {
        status,
        ...(status === "accepted" && order.channel === "pickup" ? { readyInMinutes: 20 } : {}),
      });
    }
  }
}

/**
 * Leaves the board and the floor empty so the screenshots show only this run's scene: active orders not yet
 * started are cancelled, the rest are taken to their final state, and open table accounts are charged.
 */
async function clearScene(owner: BrowserContext) {
  const base = `/api/restaurants/${restaurantId}`;
  const finals: Record<string, string[]> = {
    dine_in: ["accepted", "preparing", "ready", "served"],
    pickup: ["accepted", "preparing", "ready", "picked_up"],
    delivery: ["accepted", "preparing", "ready", "out_for_delivery", "delivered"],
  };
  const orders = (await send(owner, "get", `${base}/orders`)) as { id: string; status: string; channel: string }[];
  for (const order of orders) {
    if (order.status === "pending" || order.status === "accepted") {
      await send(owner, "post", `${base}/orders/${order.id}/status`, { status: "cancelled", reason: "Limpieza de la demo" });
      continue;
    }
    const steps = finals[order.channel] ?? [];
    for (const status of steps.slice(steps.indexOf(order.status) + 1)) {
      await send(owner, "post", `${base}/orders/${order.id}/status`, { status });
    }
  }
  const sessions = (await send(owner, "get", `${base}/table-sessions`)) as { id: string }[];
  for (const session of sessions) {
    const response = await owner.request.post(`${base}/table-sessions/${session.id}/close`, {
      data: { method: "cash", tip: 0 },
      headers: ORIGIN_HEADER,
    });
    // An overpaid or still-busy account stays open: it only adds a card to the floor screenshot.
    if (!response.ok()) console.warn(`table account ${session.id} left open: ${await response.text()}`);
  }
}

async function ownerContext(browser: Browser): Promise<BrowserContext> {
  const owner = await browser.newContext(DESKTOP);
  await send(owner, "post", "/api/auth/login", DEMO);
  return owner;
}

test("portafolio: pantallas de escritorio y funciones nuevas", async ({ browser }) => {
  test.setTimeout(600_000);
  mkdirSync(OUT, { recursive: true });
  const owner = await ownerContext(browser);
  const guest = await browser.newContext(CONTEXT_OPTIONS);
  const phone = await browser.newContext(CONTEXT_OPTIONS);
  try {
    const restaurants = (await send(owner, "get", "/api/restaurants")) as { id: string; name: string }[];
    restaurantId = restaurants.find((r) => r.name === RESTAURANT)!.id;
    tables = (await send(owner, "get", `/api/restaurants/${restaurantId}/tables`)) as { label: string; token: string }[];
    const menu = (await send(guest, "get", `/api/public/restaurants/${SLUG}/menu`)) as { categories: { products: MenuProduct[] }[] };
    products = menu.categories.flatMap((c) => c.products);
    await send(owner, "put", `/api/restaurants/${restaurantId}/accepting-orders`, { acceptingOrders: true });
    await clearScene(owner);

    // ── Landing ────────────────────────────────────────────────────────────
    const page = await owner.newPage();
    await page.goto("/");
    await waitForHydration(page);
    await shot(page, "d01-inicio");

    // ── A busy board: table and pickup orders in every column ─────────────
    const edited = await tableOrder(guest, "Mesa 4", [item("Margarita"), item("Bebida 1,5 L")]);
    await tableOrder(guest, "Mesa 5", [item("Pepperoni", 2), item("Cerveza artesanal", 2)]);
    await pickupOrder(guest, "Camila Rojas", "+56 9 8765 4301", [item("Cuatro quesos"), item("Pan de ajo")]);
    await pickupOrder(guest, "Tomás Pérez", "+56 9 8765 4302", [item("Napolitana")]);
    await pickupOrder(guest, "Valentina Soto", "+56 9 8765 4303", [item("Pollo BBQ"), item("Ensalada césar")]);
    await advance(owner, (o) => o.tableLabel === "Mesa 5", "preparing");
    await advance(owner, (o) => o.customerName === "Tomás Pérez", "accepted");
    await advance(owner, (o) => o.customerName === "Valentina Soto", "ready");

    await page.goto(`/admin/${restaurantId}/pedidos`);
    await waitForHydration(page);
    await expect(page.getByTestId("order-card").first()).toBeVisible();
    await shot(page, "d02-tablero");

    // ── Editing an order before the kitchen starts it ──────────────────────
    const card = page.getByTestId("order-card").filter({ hasText: "Mesa 4" }).first();
    await card.getByTestId("edit-order").click();
    const dialog = page.getByRole("dialog", { name: /Modificar pedido #/ });
    await dialog.getByRole("button", { name: /Quitar Bebida/ }).click();
    await dialog.getByTestId("edit-add-product").click();
    await dialog.getByTestId("edit-menu-product").filter({ hasText: "Cerveza artesanal" }).click();
    await page.getByRole("dialog", { name: "Cerveza artesanal" }).getByRole("button", { name: /^Agregar \$/ }).click();
    await dialog.getByLabel("Motivo (opcional)").fill("Cambió la bebida por una cerveza");
    await dialog.getByTestId("edit-added-line").scrollIntoViewIfNeeded();
    await shot(page, "d03-modificar-pedido");
    await dialog.getByTestId("save-edit").click();
    await expect(card.getByTestId("order-edited")).toHaveText("Modificado");
    await card.getByTestId("order-edits").locator("summary").click();
    await card.scrollIntoViewIfNeeded();
    await shot(page, "d04-pedido-modificado");

    const tracking = await phone.newPage();
    await tracking.goto(`/pedido#t=${encodeURIComponent(edited.accessToken)}`);
    await waitForHydration(tracking);
    await expect(tracking.getByTestId("order-edited-notice")).toBeVisible();
    await tracking.waitForTimeout(800);
    await tracking.screenshot({ path: join(OUT, "m01-cliente-pedido-modificado.png") });

    // ── Splitting a table bill ─────────────────────────────────────────────
    await tableOrder(guest, "Mesa 6", [item("Napolitana"), item("Cerveza artesanal", 3)]);
    await tableOrder(guest, "Mesa 6", [item("Margarita"), item("Ensalada césar")]);
    await advance(owner, (o) => o.tableLabel === "Mesa 6", "served");
    await page.goto(`/admin/${restaurantId}/salon`);
    await waitForHydration(page);
    const table = page.getByTestId("table-session").filter({ hasText: "Mesa 6" });
    await shot(page, "d05-salon");
    await table.getByTestId("charge-table").click();
    const charge = page.getByRole("dialog", { name: "Cobrar Mesa 6" });
    await charge.getByRole("radio", { name: "Partes iguales" }).click();
    await expect(charge.getByTestId("equal-part")).toHaveCount(2);
    // Three people at the table.
    await charge.getByRole("group", { name: "Cantidad de partes" }).getByRole("button", { name: "Agregar uno" }).click();
    await expect(charge.getByTestId("equal-part")).toHaveCount(3);
    await charge.getByRole("button", { name: "Cobrar parte 1" }).click();
    await charge.getByRole("radio", { name: "Efectivo" }).click();
    await charge.getByTestId("confirm-charge").click();
    await expect(charge.getByTestId("table-payment")).toHaveCount(1);
    await shot(page, "d06-dividir-cuenta");

    const billPage = await phone.newPage();
    const mesa6 = tables.find((t) => t.label === "Mesa 6")!;
    await billPage.goto(`/m/${mesa6.token}`);
    await waitForHydration(billPage);
    await billPage.getByTestId("my-bill").click();
    const sheet = billPage.getByTestId("bill-sheet");
    await expect(sheet.getByTestId("bill-plan")).toBeVisible();
    await sheet.getByTestId("bill-balance").scrollIntoViewIfNeeded();
    await billPage.waitForTimeout(800);
    await billPage.screenshot({ path: join(OUT, "m02-mesa-cuenta-dividida.png") });

    // ── Owner screens ──────────────────────────────────────────────────────
    await page.goto(`/admin/${restaurantId}/menu`);
    await waitForHydration(page);
    await expect(page.getByText("Margarita").first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    await shot(page, "d07-menu");

    await page.goto(`/admin/${restaurantId}`);
    await waitForHydration(page);
    // The delivery zone drawn on the self-hosted map (the dialog of one zone's area).
    const zone = page.getByTestId("zone-row").filter({ has: page.getByTestId("zone-area-badge") }).first();
    await zone.scrollIntoViewIfNeeded();
    await zone.getByRole("button", { name: "Editar área" }).click();
    await expect(page.getByRole("dialog", { name: /Área de reparto/ })).toBeVisible();
    await page.waitForTimeout(4_000); // map tiles
    await shot(page, "d08-zona-en-mapa");
    await page.keyboard.press("Escape");

    await page.goto(`/admin/${restaurantId}/ventas`);
    await waitForHydration(page);
    await page.waitForLoadState("networkidle");
    await shot(page, "d09-ventas");

    await page.goto(`/admin/${restaurantId}/mesas`);
    await waitForHydration(page);
    await shot(page, "d10-mesas");

    await page.goto("/plataforma");
    await waitForHydration(page);
    await page.waitForLoadState("networkidle");
    await shot(page, "d11-plataforma");

    // Public menu on a wide screen.
    const menuPage = await guest.newPage();
    await menuPage.setViewportSize({ width: 412, height: 915 });
    await menuPage.goto(`/r/${SLUG}`);
    await waitForHydration(menuPage);
    await menuPage.waitForLoadState("networkidle");
    await menuPage.screenshot({ path: join(OUT, "m03-menu-publico.png") });
  } finally {
    await owner.close();
    await guest.close();
    await phone.close();
  }
});
