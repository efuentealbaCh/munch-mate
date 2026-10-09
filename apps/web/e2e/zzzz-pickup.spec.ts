import { readFile } from "node:fs/promises";
import { type BrowserContext, type Download, expect, type Page, test } from "@playwright/test";
import {
  CONTEXT_OPTIONS,
  ORIGIN_HEADER,
  registerViaApi,
  runId,
  uniqueEmail,
  verifyEmailViaApi,
  waitForEmail,
} from "./helpers";

/*
 * Phase 4: pickup orders from the public menu. Runs last (file order) and registers 1 user; registerViaApi
 * waits out the 5/min registration limit when the earlier specs used it up.
 * Set E2E_SCREENSHOTS_DIR to save mobile screenshots of the checkout, the tracking page and the board.
 */
test.describe.configure({ mode: "serial", timeout: 240_000 });

const id = runId();
const ownerEmail = uniqueEmail("pickup-owner");
const customerEmail = uniqueEmail("pickup-customer");
const restaurantName = `Fuente ${id}`;
const RESTAURANT_PHONE = "+56 2 2345 6789";

/** Filled by the first test. */
const shared = {
  restaurantId: "",
  slug: "",
  productId: "",
  ownerState: undefined as Awaited<ReturnType<BrowserContext["storageState"]>> | undefined,
};

async function screenshot(page: Page, name: string): Promise<void> {
  const dir = process.env.E2E_SCREENSHOTS_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: false });
}

async function expectPdf(download: Download, filename: RegExp): Promise<void> {
  expect(download.suggestedFilename()).toMatch(filename);
  const file = await readFile(await download.path());
  expect(file.subarray(0, 5).toString("latin1")).toBe("%PDF-");
}

/** Owner, open restaurant with a phone and one product, via the api (pickup stays off: the test turns it on). */
async function setupRestaurant(context: BrowserContext): Promise<void> {
  const api = context.request;
  await registerViaApi(api, { name: "Pía Dueña", email: ownerEmail });
  await verifyEmailViaApi(api, ownerEmail);
  const send = async (method: "post" | "patch" | "put", path: string, data: unknown, status = 201) => {
    const response = await api[method](path, { data, headers: ORIGIN_HEADER });
    expect(response.status(), await response.text()).toBe(status);
    return (await response.json()) as Record<string, unknown>;
  };
  const restaurant = await send("post", "/api/restaurants", { name: restaurantName });
  shared.restaurantId = String(restaurant.id);
  shared.slug = String(restaurant.slug);
  expect(restaurant.pickupEnabled).toBe(false);
  const base = `/api/restaurants/${shared.restaurantId}`;
  await send("patch", base, { phone: RESTAURANT_PHONE }, 200);
  await send("put", `${base}/accepting-orders`, { acceptingOrders: true }, 200);
  const category = await send("post", `${base}/menu/categories`, { name: "Completos", description: "" });
  const product = await send("post", `${base}/menu/products`, {
    categoryId: category.id,
    name: "Italiano",
    description: "Palta, tomate y mayo",
    price: 2990,
    visible: true,
    modifierGroupIds: [],
  });
  shared.productId = String(product.id);
}

test("pickup: the owner turns it on, a customer orders, the board accepts with a time, receipt and email, hand over with payment", async ({
  browser,
}) => {
  const owner = await browser.newContext(CONTEXT_OPTIONS);
  const customer = await browser.newContext(CONTEXT_OPTIONS);
  try {
    await setupRestaurant(owner);
    const board = await owner.newPage();

    // Off by default: the public menu is read-only.
    const phone = await customer.newPage();
    await phone.goto(`/r/${shared.slug}`);
    await expect(phone.getByRole("heading", { level: 1, name: restaurantName })).toBeVisible();
    await expect(phone.getByTestId("pickup-banner")).toHaveCount(0);

    // The owner turns pickup on from the restaurant summary.
    await board.goto(`/admin/${shared.restaurantId}`);
    const pickupSwitch = board.getByRole("switch", { name: /Pedidos para retirar/ });
    await expect(pickupSwitch).not.toBeChecked();
    await pickupSwitch.click();
    await expect(pickupSwitch).toBeChecked();
    await expect(board.getByText("Ahora recibes pedidos para retirar")).toBeVisible();
    await board.reload();
    await expect(board.getByRole("switch", { name: /Pedidos para retirar/ })).toBeChecked();

    // Board open and live before the customer orders.
    await board.goto(`/admin/${shared.restaurantId}/pedidos`);
    await expect(board.getByTestId("live-badge")).toHaveText("En vivo");

    // The customer orders from the public menu.
    await phone.reload();
    await expect(phone.getByTestId("pickup-banner")).toContainText("Pide aquí y retira en el local.");
    await phone.getByTestId("public-product").filter({ hasText: "Italiano" }).click();
    const sheet = phone.getByRole("dialog", { name: "Italiano" });
    await sheet.getByRole("button", { name: "Agregar $2.990" }).click();
    await expect(sheet).toHaveCount(0);
    await phone.getByRole("button", { name: /Ver pedido \(1\)/ }).click();
    const cart = phone.getByRole("dialog", { name: "Tu pedido" });
    await expect(cart).toContainText(`Para retirar en ${restaurantName}`);
    await cart.getByLabel("Tu nombre").fill("Paula");
    await cart.getByLabel("Teléfono").fill("123");
    await cart.getByLabel("Correo (opcional)").fill(customerEmail);
    const submit = cart.getByRole("button", { name: "Pedir para retirar · $2.990" });
    await submit.click();
    // Checked in the browser with the api's own rules before sending anything.
    await expect(cart.getByText("Revisa el teléfono, ej. +569 12345678")).toBeVisible();
    await cart.getByLabel("Teléfono").fill("9 8765 4321");
    await expect(cart.getByText("Te enviamos el comprobante cuando el local acepte tu pedido.")).toBeVisible();
    await screenshot(phone, "pickup-checkout");
    await submit.click();
    await expect(phone).toHaveURL(/\/pedido#t=[A-Za-z0-9_-]{20,}$/);
    await expect(phone.getByTestId("order-status")).toHaveText("Pendiente");
    await expect(phone.getByTestId("order-destination")).toHaveText(`${restaurantName} · Para retirar`);
    await expect(phone.getByRole("list", { name: "Avance del pedido" })).toContainText("Retirado");
    await expect(phone.getByTestId("restaurant-phone")).toHaveAttribute("href", "tel:+56223456789");
    await expect(phone.getByRole("button", { name: "Descargar comprobante" })).toHaveCount(0);

    // The board shows it live, with the customer's contact data.
    const card = board.locator('[data-testid="order-card"][data-channel="pickup"]').filter({ hasText: "Paula" });
    await expect(card).toBeVisible();
    await expect(card.getByTestId("order-destination")).toHaveText("Para retirar");
    await expect(card.getByRole("link", { name: /\+569 87654321/ })).toHaveAttribute("href", "tel:+56987654321");
    await expect(card).toContainText(customerEmail);
    await expect(card).toContainText("$2.990");

    // Channel filter.
    const filter = board.getByRole("group", { name: "Filtrar por canal" });
    await filter.getByRole("button", { name: "Mesa" }).click();
    await expect(card).toHaveCount(0);
    await expect(board.getByText("No hay pedidos en curso de este tipo.")).toBeVisible();
    await filter.getByRole("button", { name: "Retiro" }).click();
    await expect(card).toBeVisible();
    await filter.getByRole("button", { name: "Todos" }).click();

    // Accepting asks for the ready time first.
    await card.getByRole("button", { name: "Aceptar" }).click();
    const acceptDialog = board.getByRole("dialog", { name: /Aceptar pedido #/ });
    const confirmAccept = acceptDialog.getByRole("button", { name: "Aceptar pedido" });
    await expect(confirmAccept).toBeDisabled();
    await acceptDialog.getByRole("radio", { name: "15 min" }).click();
    await expect(acceptDialog).toContainText(/Listo aprox\. a las \d{2}:\d{2}/);
    await confirmAccept.click();
    await expect(acceptDialog).toHaveCount(0);
    const acceptedCard = board.getByTestId("column-accepted").locator('[data-channel="pickup"]').filter({ hasText: "Paula" });
    await expect(acceptedCard.getByTestId("ready-at")).toHaveText(/^Listo aprox\. \d{2}:\d{2}$/);
    const readyAt = ((await acceptedCard.getByTestId("ready-at").textContent()) ?? "").match(/\d{2}:\d{2}/)?.[0];
    expect(readyAt).toBeTruthy();

    // The customer sees the time without reloading.
    await expect(phone.getByTestId("order-status")).toHaveText("Aceptado");
    await expect(phone.getByTestId("ready-at")).toHaveText(`Listo aprox. a las ${readyAt}`);
    await expect(phone.getByRole("button", { name: "Cancelar pedido" })).toHaveCount(0);
    await screenshot(phone, "pickup-tracking-accepted");

    // The workers generate the receipt: the customer downloads it (waits for order.receipt-ready if needed).
    const customerDownload = phone.waitForEvent("download", { timeout: 70_000 });
    await phone.getByRole("button", { name: "Descargar comprobante" }).click();
    await expectPdf(await customerDownload, /^comprobante-pedido-\d+\.pdf$/);

    // …and so does the staff.
    const staffDownload = board.waitForEvent("download", { timeout: 70_000 });
    await acceptedCard.getByRole("button", { name: "Comprobante" }).click();
    await expectPdf(await staffDownload, /^comprobante-pedido-\d+\.pdf$/);

    // The confirmation email arrives with the PDF attached and the tracking link.
    const email = await waitForEmail(customerEmail, /fue aceptado/);
    expect(email.Text).toMatch(/\/pedido#t=[A-Za-z0-9_-]{20,}/);
    expect(email.Attachments?.map((a) => a.ContentType)).toContain("application/pdf");
    const attached = await email.attachment(/^comprobante-pedido-\d+\.pdf$/);
    expect(attached.subarray(0, 5).toString("latin1")).toBe("%PDF-");

    // Kitchen flow: Empezar → Listo; the customer is told to come.
    await acceptedCard.getByRole("button", { name: "Empezar" }).click();
    await expect(phone.getByTestId("order-status")).toHaveText("En preparación");
    const preparingCard = board.getByTestId("column-preparing").locator('[data-channel="pickup"]').filter({ hasText: "Paula" });
    await preparingCard.getByRole("button", { name: "Listo" }).click();
    await expect(phone.getByTestId("order-status")).toHaveText("Listo");
    await expect(phone.getByTestId("ready-for-pickup")).toHaveText("Ya puedes retirarlo");
    await expect(phone.getByTestId("ready-at")).toHaveCount(0);
    await screenshot(phone, "pickup-tracking-ready");

    // Handing over an unpaid order warns first and offers to register the payment.
    const readyCard = board.getByTestId("column-ready").locator('[data-channel="pickup"]').filter({ hasText: "Paula" });
    await readyCard.getByRole("button", { name: "Entregar" }).click();
    const warning = board.getByRole("dialog", { name: /sin pagar/ });
    await expect(warning).toContainText("Total $2.990");
    await expect(warning.getByRole("button", { name: "Entregar sin pagar" })).toBeVisible();
    await screenshot(board, "pickup-board-handover-warning");
    await warning.getByRole("button", { name: "Efectivo y entregar" }).click();
    await expect(warning).toHaveCount(0);
    await expect(readyCard).toHaveCount(0);
    await expect(phone.getByTestId("order-status")).toHaveText("Retirado");

    // "Hoy" keeps it as paid.
    await board.getByRole("tab", { name: "Hoy" }).click();
    const row = board.getByRole("list", { name: "Pedidos de hoy" }).getByTestId("today-row").filter({ hasText: "Paula" });
    await expect(row).toContainText("Para retirar");
    await expect(row).toContainText("Retirado");
    await expect(row).toContainText("Pagado · Efectivo");
  } finally {
    shared.ownerState = await owner.storageState();
    await owner.close();
    await customer.close();
  }
});

test("pickup: a phone with 3 orders in progress gets the api's message, and closing the restaurant blocks ordering", async ({
  browser,
}) => {
  expect(shared.ownerState, "the first test signs the owner in").toBeDefined();
  const owner = await browser.newContext({ ...CONTEXT_OPTIONS, storageState: shared.ownerState });
  const customer = await browser.newContext(CONTEXT_OPTIONS);
  try {
    // Three orders in progress for the same phone (written differently: the api normalizes it).
    for (const phoneNumber of ["+56 9 5555 0001", "955550001", "(+56) 9 5555-0001"]) {
      const response = await customer.request.post(`/api/public/restaurants/${shared.slug}/orders`, {
        data: {
          clientOrderId: crypto.randomUUID(),
          customerName: "Rita",
          customerPhone: phoneNumber,
          items: [{ productId: shared.productId, quantity: 1, modifiers: [] }],
        },
        headers: ORIGIN_HEADER,
      });
      expect(response.status(), await response.text()).toBe(201);
    }

    const phone = await customer.newPage();
    await phone.goto(`/r/${shared.slug}`);
    await phone.getByTestId("public-product").filter({ hasText: "Italiano" }).click();
    await phone.getByRole("dialog", { name: "Italiano" }).getByRole("button", { name: "Agregar $2.990" }).click();
    await phone.getByRole("button", { name: /Ver pedido \(1\)/ }).click();
    const cart = phone.getByRole("dialog", { name: "Tu pedido" });
    await cart.getByLabel("Tu nombre").fill("Rita");
    await cart.getByLabel("Teléfono").fill("+56 9 5555 0001");
    await cart.getByRole("button", { name: /Pedir para retirar/ }).click();
    // The api's own 429 message, not the generic "demasiados intentos".
    await expect(cart.getByText("Ya tienes varios pedidos en curso en este local.", { exact: false })).toBeVisible();
    await expect(cart.getByRole("link", { name: "Ver mis pedidos" })).toBeVisible();
    await expect(phone).toHaveURL(new RegExp(`/r/${shared.slug}$`));

    // Closed restaurant: the menu stays browsable, ordering is blocked.
    const closed = await owner.request.put(`/api/restaurants/${shared.restaurantId}/accepting-orders`, {
      data: { acceptingOrders: false },
      headers: ORIGIN_HEADER,
    });
    expect(closed.status(), await closed.text()).toBe(200);
    await phone.goto(`/r/${shared.slug}`);
    await expect(phone.getByTestId("closed-banner")).toContainText("El local no está recibiendo pedidos ahora.");
    await phone.getByRole("button", { name: /Ver pedido \(1\)/ }).click();
    await expect(phone.getByRole("dialog", { name: "Tu pedido" }).getByRole("button", { name: /Pedir para retirar/ })).toBeDisabled();
  } finally {
    await owner.close();
    await customer.close();
  }
});
