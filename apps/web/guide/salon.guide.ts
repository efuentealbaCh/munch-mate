import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type APIRequestContext, type BrowserContext, expect, type Locator, type Page, test } from "@playwright/test";
import { CONTEXT_OPTIONS, ORIGIN_HEADER, waitForEmailLink, waitForHydration } from "../e2e/helpers";

/*
 * Phase 8 step by step on the demo data (Pizzería Forno Rosso): the discounted menu, the table account from
 * the QR (call the waiter, ask for the bill with the tip), the waiter's "Salón" (attend, charge), the owner's
 * discount editor, printer settings and sales export, and a WhatsApp notice for a pickup order (delivered to
 * Mailpit by the local stack). Saves docs/capturas/salon/*.png and capturas.json.
 */
test.describe.configure({ mode: "serial" });

const OUT = resolve(__dirname, "../../../docs/capturas/salon");
const SLUG = "pizzeria-forno-rosso";
const RESTAURANT = "Pizzería Forno Rosso";
const TABLE = "Mesa 2";
const DEMO = { email: "demo@munchmate.local", password: "munchmate demo 2026" };
const WAITER = { email: "garzon@munchmate.local", password: "munchmate demo 2026", name: "Gabi Garzón" };

const shots: Array<{ file: string; actor: string; caption: string }> = [];

async function shot(page: Page, actor: string, name: string, caption: string, focus?: Locator) {
  if (focus) await focus.evaluate((element) => element.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(500);
  const file = `${String(shots.length + 1).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path: join(OUT, file) });
  shots.push({ file, actor, caption });
  writeFileSync(join(OUT, "capturas.json"), `${JSON.stringify(shots, null, 2)}\n`);
}

async function call(api: APIRequestContext, method: "get" | "post", path: string, data?: unknown) {
  const response = await api[method](path, method === "get" ? {} : { data, headers: ORIGIN_HEADER });
  const text = await response.text();
  return { status: response.status(), body: (text ? JSON.parse(text) : null) as unknown };
}

async function login(context: BrowserContext, user: { email: string; password: string }): Promise<boolean> {
  const { status } = await call(context.request, "post", "/api/auth/login", { email: user.email, password: user.password });
  return status === 200 || status === 201;
}

/** The waiter account (role waiter in the pizzeria): invited on the first run, reused afterwards. */
async function ensureWaiter(owner: BrowserContext, waiter: BrowserContext, restaurantId: string) {
  if (!(await login(waiter, WAITER))) {
    const created = await call(waiter.request, "post", "/api/auth/register", { ...WAITER });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
  }
  const restaurants = (await call(waiter.request, "get", "/api/restaurants")).body as Array<{ id: string }>;
  if (restaurants.some((r) => r.id === restaurantId)) return;
  const invite = await call(owner.request, "post", `/api/restaurants/${restaurantId}/invitations`, { email: WAITER.email, roles: ["waiter"] });
  expect(invite.status, JSON.stringify(invite.body)).toBe(201);
  const link = await waitForEmailLink(WAITER.email, "/invitacion");
  const token = new URL(link, "https://placeholder").searchParams.get("token");
  expect((await call(waiter.request, "post", "/api/invitations/accept", { token })).status).toBeLessThan(300);
}

/** Moves every order of a table account to "served" (the kitchen's part, through the api). */
async function serveAccount(owner: BrowserContext, restaurantId: string, orderIds: string[]) {
  for (const orderId of orderIds) {
    for (const status of ["accepted", "preparing", "ready", "served"]) {
      await call(owner.request, "post", `/api/restaurants/${restaurantId}/orders/${orderId}/status`, { status });
    }
  }
}

test("salón, propina, descuentos, impresora, ventas y WhatsApp, paso a paso", async ({ browser }) => {
  test.setTimeout(600_000);
  mkdirSync(OUT, { recursive: true });
  const owner = await browser.newContext(CONTEXT_OPTIONS);
  const waiter = await browser.newContext(CONTEXT_OPTIONS);
  const customer = await browser.newContext(CONTEXT_OPTIONS);
  try {
    expect(await login(owner, DEMO), "run `pnpm seed:demo` first").toBe(true);
    const restaurants = (await call(owner.request, "get", "/api/restaurants")).body as Array<{ id: string; name: string }>;
    const restaurantId = restaurants.find((r) => r.name === RESTAURANT)!.id;
    const base = `/api/restaurants/${restaurantId}`;
    await ensureWaiter(owner, waiter, restaurantId);
    const tables = (await call(owner.request, "get", `${base}/tables`)).body as Array<{ label: string; token: string }>;
    const table = tables.find((t) => t.label === TABLE)!;
    // A clean table: an account left open by an earlier run is served and closed first.
    const open = (await call(owner.request, "get", `${base}/table-sessions`)).body as Array<{ id: string; tableLabel: string; orderIds: string[] }>;
    for (const session of open.filter((s) => s.tableLabel === TABLE)) {
      await serveAccount(owner, restaurantId, session.orderIds);
      await call(owner.request, "post", `${base}/table-sessions/${session.id}/close`, { method: "cash", tip: 0 });
    }

    // 1. The menu with the discount.
    const phone = await customer.newPage();
    await phone.goto(`/m/${table.token}`);
    await waitForHydration(phone);
    const margarita = phone.getByTestId("public-product").filter({ hasText: "Margarita" });
    await expect(margarita.getByTestId("promo-badge")).toBeVisible();
    await shot(phone, "Cliente", "menu-con-descuento", "En la mesa el menú muestra el precio con descuento, el normal tachado y el texto de la promoción.", margarita);

    // 2. Two orders from the table add up in its account.
    for (const product of ["Margarita", "Pan de ajo"]) {
      await phone.getByTestId("public-product").filter({ hasText: product }).click();
      const sheet = phone.getByRole("dialog", { name: product });
      for (const group of await sheet.getByRole("radiogroup").all()) await group.getByRole("radio").first().check();
      await sheet.getByRole("button", { name: /^Agregar \$/ }).click();
    }
    await phone.getByRole("button", { name: /Ver pedido \(2\)/ }).click();
    await phone.getByRole("button", { name: /Enviar pedido/ }).click();
    await expect(phone).toHaveURL(/\/pedido#t=/);
    await phone.goto(`/m/${table.token}`);
    await waitForHydration(phone);
    await expect(phone.getByTestId("my-bill")).toBeVisible();
    await shot(phone, "Cliente", "mesa-botones", "Con un pedido hecho aparecen «Llamar al garzón» y «Mi cuenta» con el consumo de toda la mesa.", phone.getByTestId("my-bill"));

    // 3. Call the waiter: the Salón rings.
    const floor = await waiter.newPage();
    await floor.goto("/admin");
    await floor.getByRole("link", { name: new RegExp(RESTAURANT) }).click();
    await expect(floor).toHaveURL(/\/salon$/);
    await phone.getByTestId("call-waiter").click();
    await expect(phone.getByTestId("call-waiter")).toHaveText("Garzón avisado");
    await shot(phone, "Cliente", "garzon-avisado", "«Llamar al garzón» avisa al salón al instante; el botón queda en «Garzón avisado» hasta que lo atiendan.", phone.getByTestId("call-waiter"));
    const card = floor.getByTestId("table-session").filter({ hasText: TABLE });
    await expect(card.getByTestId("waiter-call")).toBeVisible();
    await shot(floor, "Garzón", "salon-llamado", "En «Salón» la mesa sube arriba con el llamado (y suena si el sonido está activo). «Atendido» lo quita.", card);
    await card.getByRole("button", { name: "Atendido" }).click();

    // 4. The kitchen serves (api), the customer asks for the bill with the suggested tip.
    const session = ((await call(owner.request, "get", `${base}/table-sessions`)).body as Array<{ tableLabel: string; orderIds: string[] }>).find(
      (s) => s.tableLabel === TABLE,
    )!;
    await serveAccount(owner, restaurantId, session.orderIds);
    await phone.getByTestId("my-bill").click();
    const bill = phone.getByTestId("bill-sheet");
    await expect(bill.getByTestId("request-bill")).toBeEnabled();
    await shot(phone, "Cliente", "cuenta-propina", "«Mi cuenta» suma los pedidos de la mesa y ofrece la propina sugerida (10 %), otro monto o ninguna. Es voluntaria.", bill.getByTestId("request-bill"));
    await bill.getByTestId("request-bill").click();
    await expect(bill.getByTestId("bill-requested")).toBeVisible();
    await shot(phone, "Cliente", "cuenta-pedida", "Pedida la cuenta: el total con propina queda a la vista y el garzón viene a cobrar.", bill.getByTestId("bill-total"));

    // 5. The waiter charges it.
    await expect(card.getByTestId("bill-request")).toContainText("propina");
    await shot(floor, "Garzón", "salon-cuenta-pedida", "El salón ve «Pidió la cuenta» con la propina elegida. «Precuenta» la imprime; «Cobrar» la cierra.", card);
    await card.getByTestId("charge-table").click();
    const charge = floor.getByRole("dialog", { name: `Cobrar ${TABLE}` });
    await charge.getByRole("radio", { name: "Tarjeta (POS)" }).click();
    await shot(floor, "Garzón", "cobrar", "Al cobrar se confirma la propina (editable) y el medio de pago; se pagan todos los pedidos de la mesa.");
    await charge.getByTestId("confirm-charge").click();
    await expect(floor.getByTestId("table-session").filter({ hasText: TABLE })).toHaveCount(0);
    await expect(bill.getByTestId("bill-paid")).toBeVisible();
    await shot(phone, "Cliente", "cuenta-pagada", "En el teléfono de la mesa la cuenta queda pagada. El próximo pedido abre una cuenta nueva.", bill.getByTestId("bill-paid"));

    // 6. The owner's side: discount editor, printer, sales.
    const admin = await owner.newPage();
    await admin.goto(`/admin/${restaurantId}/menu`);
    await admin.getByRole("button", { name: "Editar Margarita" }).click();
    const promo = admin.getByTestId("promo-field");
    await expect(promo.getByTestId("promo-preview")).toBeVisible();
    await shot(admin, "Dueño", "editor-descuento", "Menú → editar producto → «Descuento»: porcentaje o precio especial, días y fechas, con la vista previa del precio.", promo);
    await admin.goto(`/admin/${restaurantId}/pedidos`);
    await admin.getByTestId("print-settings").click();
    await expect(admin.getByRole("dialog", { name: "Impresora de comandas" })).toBeVisible();
    await shot(admin, "Cocina", "impresora", "«Impresora» en Pedidos: papel de 58 u 80 mm e impresión automática de comandas, por dispositivo.");
    await admin.keyboard.press("Escape");
    await admin.goto(`/admin/${restaurantId}/ventas`);
    await expect(admin.getByTestId("kpi-tips")).toBeVisible();
    await shot(admin, "Dueño / caja", "ventas-dia", "Ventas del día con las propinas aparte, los descuentos y la exportación a Excel por pedido, producto o día.", admin.getByTestId("tips-discounts"));
    await admin.getByRole("tab", { name: "Rango y exportar" }).click();
    await expect(admin.getByTestId("range-report")).toBeVisible();
    await shot(admin, "Dueño / caja", "ventas-rango", "«Rango y exportar»: cualquier periodo con una fila por día, para descargar o imprimir.", admin.getByTestId("range-days"));
    await admin.goto(`/admin/${restaurantId}`);
    const notices = admin.getByRole("form", { name: "Avisos por mensaje" });
    await shot(admin, "Dueño", "avisos-config", "Resumen → «Avisos por WhatsApp o SMS»: canal y número de envío del local.", notices);

    // 7. A pickup customer asks for WhatsApp notices.
    const pickup = await customer.newPage();
    await pickup.goto(`/r/${SLUG}`);
    await waitForHydration(pickup);
    await pickup.getByTestId("public-product").filter({ hasText: "Pan de ajo" }).click();
    await pickup.getByRole("dialog", { name: "Pan de ajo" }).getByRole("button", { name: /^Agregar \$/ }).click();
    await pickup.getByRole("button", { name: /Ver pedido \(1\)/ }).click();
    const cart = pickup.getByRole("dialog", { name: "Tu pedido" });
    const channel = cart.getByRole("radiogroup", { name: "¿Cómo quieres recibirlo?" });
    if (await channel.count()) await channel.getByRole("radio", { name: /Retiro/ }).check();
    const phoneNumber = `9${String(Date.now()).slice(-8)}`;
    await cart.getByLabel("Tu nombre").fill("Valentina");
    await cart.getByLabel("Teléfono").fill(phoneNumber);
    await cart.getByLabel(/Avísame por WhatsApp/).check();
    await shot(pickup, "Cliente", "checkout-whatsapp", "Al pedir para retiro o delivery, «Avísame por WhatsApp a este número» (solo celulares).", cart.getByTestId("notify-option"));
    await cart.getByRole("button", { name: /Pedir para retirar/ }).click();
    await expect(pickup).toHaveURL(/\/pedido#t=/);
    const orders = (await call(owner.request, "get", `${base}/orders`)).body as Array<{ id: string; customerName: string }>;
    const order = orders.find((o) => o.customerName === "Valentina")!;
    await call(owner.request, "post", `${base}/orders/${order.id}/status`, { status: "accepted", readyInMinutes: 15 });
    await expect(pickup.getByTestId("message-notices")).toBeVisible();
    await shot(pickup, "Cliente", "seguimiento-whatsapp", "El seguimiento confirma los avisos por WhatsApp.", pickup.getByTestId("message-notices"));

    const mailpit = await customer.newPage();
    const address = `569${phoneNumber.slice(1)}@whatsapp.mensajes.local`;
    for (let i = 0; i < 30; i++) {
      const found = (await (await fetch(`http://127.0.0.1:8025/api/v1/search?query=to:${address}`)).json()) as { messages: { ID: string }[] };
      if (found.messages.length > 0) {
        await mailpit.goto(`http://127.0.0.1:8025/view/${found.messages[0]!.ID}`);
        break;
      }
      await mailpit.waitForTimeout(500);
    }
    // The message is shown in a frame; the subject is in the page itself.
    await expect(mailpit.getByText(/[WhatsApp] de/).first()).toBeVisible();
    await mailpit.waitForTimeout(1_000);
    await shot(mailpit, "Mailpit (local)", "mensaje-whatsapp", "En local el mensaje llega a Mailpit; en producción sale por WhatsApp desde el número del local.");
  } finally {
    await owner.close();
    await waiter.close();
    await customer.close();
  }
});
