import { readFile } from "node:fs/promises";
import { type Browser, type BrowserContext, expect, type Page, test } from "@playwright/test";
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
 * Phase 3: dine-in orders from a table QR, the live staff board and the customer's tracking page.
 * Runs after zz-menu.spec.ts (file order) and registers 2 users; registerViaApi waits out the 5/min limit.
 * The tests share one restaurant and run in order.
 */
test.describe.configure({ mode: "serial", timeout: 180_000 });

const id = runId();
const ownerEmail = uniqueEmail("orders-owner");
const cookEmail = uniqueEmail("orders-cook");
const restaurantName = `Picada ${id}`;

/** Filled by the first test. */
const shared = {
  restaurantId: "",
  slug: "",
  tableToken: "",
  productId: "",
  sizeGroupId: "",
  normalOptionId: "",
  ownerState: undefined as Awaited<ReturnType<BrowserContext["storageState"]>> | undefined,
};

/** Records every request to /api/auth/* made by a page (public pages must make none). */
function trackAuthCalls(page: Page): string[] {
  const calls: string[] = [];
  page.on("request", (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith("/api/auth/")) calls.push(`${request.method()} ${pathname}`);
  });
  return calls;
}

async function ownerContext(browser: Browser): Promise<BrowserContext> {
  expect(shared.ownerState, "the first test signs the owner in").toBeDefined();
  return browser.newContext({ ...CONTEXT_OPTIONS, storageState: shared.ownerState });
}

/** Sets up the owner, the restaurant and a menu with a required size and optional extras, via the api. */
async function setupRestaurant(context: BrowserContext): Promise<void> {
  const api = context.request;
  await registerViaApi(api, { name: "Olga Dueña", email: ownerEmail });
  await verifyEmailViaApi(api, ownerEmail);
  const post = async (path: string, data: unknown) => {
    const response = await api.post(path, { data, headers: ORIGIN_HEADER });
    expect(response.status(), await response.text()).toBe(201);
    return (await response.json()) as Record<string, unknown>;
  };
  const restaurant = await post("/api/restaurants", { name: restaurantName });
  shared.restaurantId = String(restaurant.id);
  shared.slug = String(restaurant.slug);
  const menu = `/api/restaurants/${shared.restaurantId}/menu`;
  const category = await post(`${menu}/categories`, { name: "Sándwiches", description: "" });
  const size = (await post(`${menu}/modifier-groups`, {
    name: "Tamaño",
    minSelect: 1,
    maxSelect: 1,
    options: [
      { name: "Normal", priceDelta: 0, available: true },
      { name: "Grande", priceDelta: 800, available: true },
    ],
  })) as { id: string; options: Array<{ id: string; name: string }> };
  const extras = (await post(`${menu}/modifier-groups`, {
    name: "Agregados",
    minSelect: 0,
    maxSelect: 2,
    options: [
      { name: "Palta", priceDelta: 900, available: true },
      { name: "Queso", priceDelta: 500, available: true },
      { name: "Tomate", priceDelta: 300, available: true },
    ],
  })) as { id: string };
  const product = await post(`${menu}/products`, {
    categoryId: category.id,
    name: "Chacarero",
    description: "Carne, porotos verdes, tomate y ají",
    price: 3990,
    visible: true,
    modifierGroupIds: [size.id, extras.id],
  });
  shared.productId = String(product.id);
  shared.sizeGroupId = size.id;
  shared.normalOptionId = size.options.find((option) => option.name === "Normal")?.id ?? "";
}

/** Places an order through the public api (as a second customer) and returns its ticket number. */
async function placeOrderViaApi(context: BrowserContext, customerName: string): Promise<number> {
  const response = await context.request.post(`/api/public/tables/${shared.tableToken}/orders`, {
    data: {
      clientOrderId: crypto.randomUUID(),
      customerName,
      items: [
        {
          productId: shared.productId,
          quantity: 1,
          modifiers: [{ groupId: shared.sizeGroupId, optionIds: [shared.normalOptionId] }],
        },
      ],
    },
    headers: ORIGIN_HEADER,
  });
  expect(response.status(), await response.text()).toBe(201);
  return ((await response.json()) as { order: { ticketNumber: number } }).order.ticketNumber;
}

/** Customer flow in the table page: Chacarero, Grande + Palta, with a name. Lands on the tracking page. */
async function orderFromTable(page: Page, customerName: string): Promise<void> {
  await page.goto(`/m/${shared.tableToken}`);
  await expect(page.getByRole("heading", { level: 1, name: restaurantName })).toBeVisible();
  await expect(page.getByTestId("table-label")).toHaveText("Mesa 4");
  await page.getByTestId("public-product").filter({ hasText: "Chacarero" }).click();
  const sheet = page.getByRole("dialog", { name: "Chacarero" });
  // Required size not chosen yet: cannot add.
  const add = sheet.getByRole("button", { name: /^Agregar \$/ });
  await expect(add).toBeDisabled();
  await expect(sheet).toContainText("Obligatorio · elige 1");
  await sheet.getByRole("radio", { name: /Grande/ }).click();
  await sheet.getByRole("checkbox", { name: /Palta/ }).click();
  // 3.990 + 800 + 900
  await expect(add).toHaveText("Agregar $5.690");
  await add.click();
  await expect(sheet).toHaveCount(0);

  await page.getByRole("button", { name: /Ver pedido \(1\)/ }).click();
  const cart = page.getByRole("dialog", { name: "Tu pedido" });
  await expect(cart.getByTestId("cart-line")).toContainText("Grande · Palta");
  await expect(cart.getByTestId("cart-total")).toHaveText("$5.690");
  await cart.getByLabel("Tu nombre (opcional)").fill(customerName);
  await cart.getByRole("button", { name: "Enviar pedido · $5.690" }).click();
  await expect(page).toHaveURL(/\/pedido#t=[A-Za-z0-9_-]{20,}$/);
  await expect(page.getByTestId("order-status")).toHaveText("Pendiente");
}

test("a customer orders from a table QR, the board shows it live, and accepting it updates the customer live", async ({ browser }) => {
  const owner = await browser.newContext(CONTEXT_OPTIONS);
  const customer = await browser.newContext(CONTEXT_OPTIONS);
  try {
    await setupRestaurant(owner);
    const board = await owner.newPage();

    // Open the restaurant from the board (it starts closed).
    await board.goto(`/admin/${shared.restaurantId}`);
    await expect(board.getByTestId("open-badge")).toHaveText("Cerrado");
    const tabs = board.getByRole("navigation", { name: "Secciones del restaurante" });
    await tabs.getByRole("link", { name: "Pedidos" }).click();
    const open = board.getByRole("switch", { name: /Recibiendo pedidos/ });
    await expect(open).not.toBeChecked();
    await open.click();
    await expect(open).toBeChecked();
    await expect(board.getByTestId("open-badge")).toHaveText("Recibiendo pedidos");

    // Create a table.
    await tabs.getByRole("link", { name: "Mesas" }).click();
    await expect(board.getByText("Todavía no tienes mesas.")).toBeVisible();
    const addForm = board.getByRole("form", { name: "Agregar mesa" });
    await addForm.getByLabel("Nueva mesa").fill("Mesa 4");
    await addForm.getByRole("button", { name: "Agregar", exact: true }).click();
    const row = board.getByTestId("table-row").filter({ hasText: "Mesa 4" });
    await expect(row.getByRole("img", { name: "Código QR de Mesa 4" })).toBeVisible();
    shared.tableToken = ((await row.getByTestId("table-code").textContent()) ?? "").replace("/m/", "").trim();
    expect(shared.tableToken).toMatch(/^[a-z0-9]{10}$/);

    // Board open and live before the customer orders.
    await tabs.getByRole("link", { name: "Pedidos" }).click();
    await expect(board.getByTestId("live-badge")).toHaveText("En vivo");
    await expect(board.getByText("No hay pedidos en curso.")).toBeVisible();

    const phone = await customer.newPage();
    const authCalls = trackAuthCalls(phone);
    await orderFromTable(phone, "Ana");

    // The new order appears on the board without reloading.
    const card = board.getByTestId("order-card").filter({ hasText: "Ana" });
    await expect(card).toBeVisible();
    await expect(card).toContainText("Mesa 4");
    await expect(card).toContainText("1 × Chacarero");
    await expect(card).toContainText("Grande");
    await expect(card).toContainText("$5.690");
    await expect(card).toContainText("Sin pagar");
    await expect(board).toHaveTitle(/^\(1\) Pedidos/);
    await expect(board.getByTestId("column-pending").getByTestId("order-card")).toHaveCount(1);

    // Accept → the customer sees it without reloading.
    await card.getByRole("button", { name: "Aceptar" }).click();
    await expect(board.getByTestId("column-accepted").getByTestId("order-card").filter({ hasText: "Ana" })).toBeVisible();
    await expect(phone.getByTestId("order-status")).toHaveText("Aceptado");
    await expect(phone.getByRole("button", { name: "Cancelar pedido" })).toHaveCount(0);

    // Move it along: Empezar → Listo; the customer follows.
    await card.getByRole("button", { name: "Empezar" }).click();
    await expect(phone.getByTestId("order-status")).toHaveText("En preparación");

    // Owner registers the payment.
    await card.getByRole("button", { name: "Registrar pago" }).click();
    await board.getByRole("dialog", { name: /Registrar pago/ }).getByRole("button", { name: "Efectivo" }).click();
    await expect(card).toContainText("Pagado · Efectivo");

    expect(authCalls, "public pages must not call /api/auth/*").toEqual([]);
  } finally {
    shared.ownerState = await owner.storageState();
    await owner.close();
    await customer.close();
  }
});

test("rejecting with a reason shows the reason to the customer", async ({ browser }) => {
  const owner = await ownerContext(browser);
  const customer = await browser.newContext(CONTEXT_OPTIONS);
  try {
    const board = await owner.newPage();
    await board.goto(`/admin/${shared.restaurantId}/pedidos`);
    await expect(board.getByTestId("live-badge")).toHaveText("En vivo");

    const phone = await customer.newPage();
    await orderFromTable(phone, "Bruno");

    const card = board.getByTestId("order-card").filter({ hasText: "Bruno" });
    await card.getByRole("button", { name: "Rechazar" }).click();
    const dialog = board.getByRole("dialog", { name: /Rechazar pedido/ });
    // The reason is mandatory.
    await dialog.getByRole("button", { name: "Rechazar pedido" }).click();
    await expect(dialog.getByText("Indica el motivo: el cliente lo verá")).toBeVisible();
    await dialog.getByRole("button", { name: "Cocina saturada" }).click();
    await dialog.getByRole("button", { name: "Rechazar pedido" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(card).toHaveCount(0);

    await expect(phone.getByTestId("order-status")).toHaveText("Rechazado");
    await expect(phone.getByTestId("reject-reason")).toHaveText("Motivo: Cocina saturada");

    // "Hoy" keeps finished orders and sums the day.
    await board.getByRole("tab", { name: "Hoy" }).click();
    const today = board.getByRole("list", { name: "Pedidos de hoy" });
    await expect(today.getByTestId("today-row")).toHaveCount(2);
    await expect(today.getByTestId("today-row").filter({ hasText: "Bruno" })).toContainText("Rechazado");
    const summary = board.getByRole("definition").filter({ hasText: "$" });
    await expect(summary.first()).toHaveText("$5.690");
  } finally {
    await owner.close();
    await customer.close();
  }
});

test("a closed restaurant shows a banner and the menu cannot be ordered from", async ({ browser }) => {
  const owner = await ownerContext(browser);
  const customer = await browser.newContext(CONTEXT_OPTIONS);
  try {
    const board = await owner.newPage();
    await board.goto(`/admin/${shared.restaurantId}/pedidos`);
    await expect(board.getByTestId("live-badge")).toHaveText("En vivo");
    const open = board.getByRole("switch", { name: /Recibiendo pedidos/ });
    await expect(open).toBeChecked();

    // Closed from "another device": this board follows the restaurant.accepting event.
    const closed = await owner.request.put(`/api/restaurants/${shared.restaurantId}/accepting-orders`, {
      data: { acceptingOrders: false },
      headers: ORIGIN_HEADER,
    });
    expect(closed.status(), await closed.text()).toBe(200);
    await expect(open).not.toBeChecked();
    await expect(board.getByTestId("open-badge")).toHaveText("Cerrado");

    const phone = await customer.newPage();
    const authCalls = trackAuthCalls(phone);
    await phone.goto(`/m/${shared.tableToken}`);
    await expect(phone.getByTestId("closed-banner")).toContainText("El local no está recibiendo pedidos ahora");
    await phone.getByTestId("public-product").filter({ hasText: "Chacarero" }).click();
    const sheet = phone.getByRole("dialog", { name: "Chacarero" });
    await expect(sheet).toContainText("El local no está recibiendo pedidos ahora.");
    await expect(sheet.getByRole("button", { name: /^Agregar/ })).toHaveCount(0);

    // The public menu and the tracking list do not touch the session either.
    await phone.goto(`/r/${shared.slug}`);
    await expect(phone.getByRole("heading", { level: 1, name: restaurantName })).toBeVisible();
    await phone.goto("/pedido");
    await expect(phone.getByRole("heading", { name: "Mis pedidos" })).toBeVisible();
    expect(authCalls, "public pages must not call /api/auth/*").toEqual([]);

    // Unknown codes get the friendly page.
    const missing = await phone.goto("/m/zzzzzzzzzz");
    expect(missing?.status()).toBe(404);
    await expect(phone.getByRole("heading", { name: "Este código QR no está activo" })).toBeVisible();

    // Reopen for the next tests.
    await open.click();
    await expect(open).toBeChecked();
  } finally {
    await owner.close();
    await customer.close();
  }
});

test("the owner downloads the PDF with every table QR", async ({ browser }) => {
  const owner = await ownerContext(browser);
  try {
    const page = await owner.newPage();
    await page.goto(`/admin/${shared.restaurantId}/mesas`);
    const downloadStarted = page.waitForEvent("download", { timeout: 70_000 });
    await page.getByRole("button", { name: "Descargar PDF con todos los QR" }).click();
    const download = await downloadStarted;
    expect(download.suggestedFilename()).toBe("codigos-qr-mesas.pdf");
    const file = await readFile(await download.path());
    expect(file.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  } finally {
    await owner.close();
  }
});

test("kitchen staff see Pedidos but not Mesas, and cannot register payments", async ({ browser }) => {
  const owner = await ownerContext(browser);
  const cook = await browser.newContext(CONTEXT_OPTIONS);
  try {
    const invite = await owner.request.post(`/api/restaurants/${shared.restaurantId}/invitations`, {
      data: { email: cookEmail, roles: ["kitchen"] },
      headers: ORIGIN_HEADER,
    });
    expect(invite.status(), await invite.text()).toBe(201);
    await registerViaApi(cook.request, { name: "Coco Cocina", email: cookEmail });
    const token = new URL(await waitForEmailLink(cookEmail, "/invitacion"), "https://x").searchParams.get("token");
    const accepted = await cook.request.post("/api/invitations/accept", { data: { token }, headers: ORIGIN_HEADER });
    expect(accepted.status(), await accepted.text()).toBe(200);
    const ticket = await placeOrderViaApi(owner, "Carla");

    const page = await cook.newPage();
    await page.goto(`/admin/${shared.restaurantId}`);
    const tabs = page.getByRole("navigation", { name: "Secciones del restaurante" });
    await expect(tabs.getByRole("link", { name: "Mesas" })).toHaveCount(0);
    await tabs.getByRole("link", { name: "Pedidos" }).click();
    const card = page.locator(`[data-testid="order-card"][data-ticket="${ticket}"]`);
    await expect(card.getByRole("button", { name: "Aceptar" })).toBeVisible();
    await expect(card.getByRole("button", { name: "Rechazar" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Registrar pago" })).toHaveCount(0);
    await card.getByRole("button", { name: "Aceptar" }).click();
    await expect(page.getByTestId("column-accepted").locator(`[data-ticket="${ticket}"]`)).toBeVisible();

    await page.goto(`/admin/${shared.restaurantId}/mesas`);
    await expect(page.getByRole("heading", { name: "Solo para dueños" })).toBeVisible();
  } finally {
    await owner.close();
    await cook.close();
  }
});

test("the board reconnects after losing the network with an expired access cookie, and catches up", async ({ browser }) => {
  const owner = await ownerContext(browser);
  try {
    const board = await owner.newPage();
    await board.goto(`/admin/${shared.restaurantId}/pedidos`);
    const live = board.getByTestId("live-badge");
    await expect(live).toHaveText("En vivo");

    // The access cookie "expires" (it lives 15 min) while the device is offline; an order arrives meanwhile.
    await owner.clearCookies({ name: "mm_at" });
    await owner.setOffline(true);
    await expect(live).toHaveText("Reconectando…", { timeout: 30_000 });
    const customer = await browser.newContext(CONTEXT_OPTIONS);
    const ticket = await placeOrderViaApi(customer, "Dora").finally(() => customer.close());
    await owner.setOffline(false);

    // New handshake without a valid cookie → subscribe says UNAUTHENTICATED → session refreshed → reconnect,
    // then the REST refetch brings the order emitted while offline (events are not replayed).
    await expect(live).toHaveText("En vivo", { timeout: 30_000 });
    await expect(board.locator(`[data-testid="order-card"][data-ticket="${ticket}"]`)).toBeVisible();
    expect((await owner.cookies()).some((cookie) => cookie.name === "mm_at")).toBe(true);
  } finally {
    await owner.close();
  }
});
