import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import {
  CONTEXT_OPTIONS,
  ORIGIN_HEADER,
  registerViaApi,
  runId,
  uniqueEmail,
  verifyEmailViaApi,
  waitForEmail,
  waitForEmailLink,
  waitForHydration,
} from "./helpers";

/*
 * Phase 8 in the browser: a product discount on the menu, the table account (call the waiter, ask for the
 * bill with the suggested tip, the waiter charges it from "Salón"), the kitchen ticket printed from the board,
 * the WhatsApp notice opt-in (delivered to Mailpit by the local stack) and the sales export. Registers 2 users
 * (the owner and a waiter).
 */
test.describe.configure({ mode: "serial", timeout: 240_000 });

const id = runId();
const ownerEmail = uniqueEmail("floor-owner");
const waiterEmail = uniqueEmail("floor-waiter");
const restaurantName = `Trattoria ${id}`;

const shared = { restaurantId: "", slug: "", tableToken: "", productId: "" };

async function send(context: BrowserContext, method: "post" | "patch" | "put", path: string, data: unknown, status = 200) {
  const response = await context.request[method](path, { data, headers: ORIGIN_HEADER });
  expect(response.status(), await response.text()).toBe(status);
  return (await response.json()) as Record<string, unknown>;
}

/** Open restaurant with pickup, a $10.000 lasagna at 20 % off every day, a table and a waiter. */
async function setup(owner: BrowserContext, waiter: BrowserContext): Promise<void> {
  await registerViaApi(owner.request, { name: "Olga Dueña", email: ownerEmail });
  await verifyEmailViaApi(owner.request, ownerEmail);
  const restaurant = await send(owner, "post", "/api/restaurants", { name: restaurantName }, 201);
  shared.restaurantId = String(restaurant.id);
  shared.slug = String(restaurant.slug);
  const base = `/api/restaurants/${shared.restaurantId}`;
  await send(owner, "patch", base, { phone: "+56 2 2345 6789", pickupEnabled: true });
  await send(owner, "put", `${base}/accepting-orders`, { acceptingOrders: true });
  const category = await send(owner, "post", `${base}/menu/categories`, { name: "Pastas", description: "" }, 201);
  const product = await send(
    owner,
    "post",
    `${base}/menu/products`,
    { categoryId: category.id, name: "Lasaña", description: "", price: 10000, visible: true, modifierGroupIds: [] },
    201,
  );
  shared.productId = String(product.id);
  await send(owner, "put", `${base}/menu/products/${shared.productId}/promo`, { kind: "percent", value: 20, label: "Martes de pasta" });
  const table = await send(owner, "post", `${base}/tables`, { label: "Mesa 8" }, 201);
  shared.tableToken = String(table.token);

  await send(owner, "post", `${base}/invitations`, { email: waiterEmail, roles: ["waiter"] }, 201);
  await registerViaApi(waiter.request, { name: "Gabi Garzón", email: waiterEmail });
  const link = await waitForEmailLink(waiterEmail, "/invitacion");
  const token = new URL(link, "https://placeholder").searchParams.get("token");
  await send(waiter, "post", "/api/invitations/accept", { token });
}

async function orderAtTable(phone: Page) {
  await phone.goto(`/m/${shared.tableToken}`);
  await waitForHydration(phone);
  await phone.getByTestId("public-product").filter({ hasText: "Lasaña" }).click();
  await phone.getByRole("dialog", { name: "Lasaña" }).getByRole("button", { name: "Agregar $8.000" }).click();
  await phone.getByRole("button", { name: /Ver pedido \(1\)/ }).click();
  await phone.getByRole("button", { name: /Enviar pedido/ }).click();
  await expect(phone).toHaveURL(/\/pedido#t=/);
}

let owner: BrowserContext;
let waiter: BrowserContext;

test.beforeAll(async ({ browser }) => {
  // Two registrations: after the rest of the suite the rate limit (5/min) may make them wait for the window.
  test.setTimeout(180_000);
  owner = await browser.newContext(CONTEXT_OPTIONS);
  waiter = await browser.newContext(CONTEXT_OPTIONS);
  await setup(owner, waiter);
});

test.afterAll(async () => {
  await owner?.close();
  await waiter?.close();
});

test("the discount shows on the menu and the table account is charged with the tip from Salón", async ({ browser }) => {
  const customer = await browser.newContext(CONTEXT_OPTIONS);
  try {
    const phone = await customer.newPage();
    await phone.goto(`/m/${shared.tableToken}`);
    await waitForHydration(phone);
    const card = phone.getByTestId("public-product").filter({ hasText: "Lasaña" });
    await expect(card.getByTestId("product-price")).toContainText("$8.000");
    await expect(card.getByTestId("product-price")).toContainText("$10.000");
    await expect(card.getByTestId("promo-badge")).toHaveText("Martes de pasta");
    await expect(phone.getByTestId("my-bill")).toHaveCount(0);

    await orderAtTable(phone);
    await orderAtTable(phone);

    // The waiter's floor: the table with its account.
    const floor = await waiter.newPage();
    await floor.goto("/admin");
    await floor.getByRole("link", { name: new RegExp(restaurantName) }).click();
    await expect(floor).toHaveURL(new RegExp(`/admin/${shared.restaurantId}/salon$`));
    const table = floor.getByTestId("table-session").filter({ hasText: "Mesa 8" });
    await expect(table.getByTestId("session-subtotal")).toHaveText("$16.000");

    // The customer calls the waiter: the floor sees it live, and the waiter attends.
    await phone.goto(`/m/${shared.tableToken}`);
    await waitForHydration(phone);
    await phone.getByTestId("call-waiter").click();
    await expect(phone.getByTestId("call-waiter")).toHaveText("Garzón avisado");
    await expect(table.getByTestId("waiter-call")).toContainText("Llama al garzón");
    await table.getByRole("button", { name: "Atendido" }).click();
    await expect(table.getByTestId("waiter-call")).toHaveCount(0);
    await expect(phone.getByTestId("call-waiter")).toHaveText("Llamar al garzón");

    // The kitchen serves both orders (through the api: this test is about the floor, not the board).
    const base = `/api/restaurants/${shared.restaurantId}`;
    const active = (await (await owner.request.get(`${base}/orders`)).json()) as { id: string }[];
    for (const order of active) {
      for (const status of ["accepted", "preparing", "ready", "served"]) {
        await send(owner, "post", `${base}/orders/${order.id}/status`, { status });
      }
    }

    // The customer asks for the bill with the suggested 10 %.
    await phone.getByTestId("my-bill").click();
    const sheet = phone.getByTestId("bill-sheet");
    await expect(sheet.getByTestId("bill-line")).toHaveText(/2 × Lasaña\s*\$16\.000/);
    await sheet.getByTestId("request-bill").click();
    await expect(sheet.getByTestId("bill-requested")).toBeVisible();
    await expect(sheet.getByTestId("bill-total")).toHaveText("$17.600");
    await expect(table.getByTestId("bill-request")).toContainText("propina $1.600");

    // The waiter charges it by card with that tip.
    await table.getByTestId("charge-table").click();
    const charge = floor.getByRole("dialog", { name: "Cobrar Mesa 8" });
    await expect(charge.getByTestId("charge-total")).toHaveText("$17.600");
    await charge.getByRole("radio", { name: "Tarjeta (POS)" }).click();
    await charge.getByTestId("confirm-charge").click();
    await expect(floor.getByTestId("table-session").filter({ hasText: "Mesa 8" })).toHaveCount(0);
    await expect(sheet.getByTestId("bill-paid")).toBeVisible();

    // Sales: the day's tips, apart from the sales.
    const sales = await owner.newPage();
    await sales.goto(`/admin/${shared.restaurantId}/ventas`);
    await expect(sales.getByTestId("kpi-total")).toContainText("$16.000");
    await expect(sales.getByTestId("kpi-tips")).toHaveText("$1.600");
    await sales.close();
    await floor.close();
  } finally {
    await customer.close();
  }
});

test("the board prints the kitchen ticket and the sales export downloads a CSV", async () => {
  const board = await owner.newPage();
  // The print dialog cannot be driven headless: record what was on the ticket when print() was called.
  await board.addInitScript(() => {
    const printed: string[] = [];
    (window as unknown as { __printed: string[] }).__printed = printed;
    window.print = () => {
      printed.push(document.getElementById("print-root")?.innerText ?? "");
      window.dispatchEvent(new Event("afterprint"));
    };
  });
  await board.goto(`/admin/${shared.restaurantId}/pedidos`);
  const response = await owner.request.post(`/api/public/tables/${shared.tableToken}/orders`, {
    data: { clientOrderId: crypto.randomUUID(), items: [{ productId: shared.productId, quantity: 3, modifiers: [] }] },
    headers: ORIGIN_HEADER,
  });
  expect(response.status(), await response.text()).toBe(201);
  const card = board.getByTestId("order-card").filter({ hasText: "Mesa 8" }).first();
  await card.getByRole("button", { name: /Imprimir comanda/ }).click();
  const printed = () => board.evaluate(() => (window as unknown as { __printed: string[] }).__printed);
  await expect.poll(printed).toHaveLength(1);
  const [ticket] = await printed();
  expect(ticket).toContain("3 × Lasaña");
  expect(ticket).toContain("Mesa 8");
  // A kitchen ticket has no prices.
  expect(ticket).not.toContain("$");

  await board.goto(`/admin/${shared.restaurantId}/ventas`);
  const download = board.waitForEvent("download");
  await board.getByTestId("export-orders").click();
  expect((await download).suggestedFilename()).toMatch(new RegExp(`^ventas-pedidos-${shared.slug}-\\d{4}-\\d{2}-\\d{2}\\.csv$`));
  await board.close();
});

test("a pickup customer asks for WhatsApp notices and gets one when the order is accepted", async ({ browser }) => {
  // The owner turns notices on with the restaurant's sender number (settings, Resumen).
  const settings = await owner.newPage();
  await settings.goto(`/admin/${shared.restaurantId}`);
  const notices = settings.getByRole("form", { name: "Avisos por mensaje" });
  await notices.getByLabel("Avisar a los clientes por mensaje").click();
  await notices.getByLabel("Número de envío").fill("9 2222 3333");
  await notices.getByRole("button", { name: "Guardar avisos" }).click();
  await expect(settings.getByText("Avisos por WhatsApp activados")).toBeVisible();
  await settings.close();

  const customer = await browser.newContext(CONTEXT_OPTIONS);
  const phoneNumber = `9${String(Date.now()).slice(-8)}`;
  try {
    const phone = await customer.newPage();
    await phone.goto(`/r/${shared.slug}`);
    await waitForHydration(phone);
    await phone.getByTestId("public-product").filter({ hasText: "Lasaña" }).click();
    await phone.getByRole("dialog", { name: "Lasaña" }).getByRole("button", { name: "Agregar $8.000" }).click();
    await phone.getByRole("button", { name: /Ver pedido \(1\)/ }).click();
    const cart = phone.getByRole("dialog", { name: "Tu pedido" });
    await cart.getByLabel("Tu nombre").fill("Rita");
    // A landline cannot get WhatsApp: the form asks for a mobile.
    await cart.getByLabel("Teléfono").fill("+56 2 2345 6789");
    await cart.getByLabel(/Avísame por WhatsApp/).check();
    await cart.getByRole("button", { name: /Pedir para retirar/ }).click();
    await expect(cart.getByText(/usa un celular/)).toBeVisible();
    await cart.getByLabel("Teléfono").fill(phoneNumber);
    await cart.getByRole("button", { name: /Pedir para retirar/ }).click();
    await expect(phone).toHaveURL(/\/pedido#t=/);
    await expect(phone.getByTestId("message-notices")).toContainText("Te avisamos por WhatsApp");

    const board = await owner.newPage();
    await board.goto(`/admin/${shared.restaurantId}/pedidos`);
    const order = board.locator('[data-testid="order-card"][data-channel="pickup"]').filter({ hasText: "Rita" });
    await order.getByRole("button", { name: "Aceptar" }).click();
    const dialog = board.getByRole("dialog", { name: /Aceptar pedido #/ });
    await dialog.getByRole("radio", { name: "15 min" }).click();
    await dialog.getByRole("button", { name: "Aceptar pedido" }).click();

    const message = await waitForEmail(`569${phoneNumber.slice(1)}@whatsapp.mensajes.local`, /\[WhatsApp\]/);
    expect(message.Subject).toBe(`[WhatsApp] de +56922223333 para +569${phoneNumber.slice(1)}`);
    expect(message.Text).toMatch(new RegExp(`^${restaurantName}: aceptamos tu pedido #\\d+\\. Estará listo a las \\d{2}:\\d{2}\\.`));
    await board.close();
  } finally {
    await customer.close();
  }
});
