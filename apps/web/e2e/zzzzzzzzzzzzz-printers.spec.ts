import { expect, request, test } from "@playwright/test";
import { BASE_URL, CONTEXT_OPTIONS, ORIGIN_HEADER, registerViaApi, runId, uniqueEmail, verifyEmailViaApi, waitForHydration } from "./helpers";

/*
 * Print agent (phase 8) on the web: the owner opens «Impresoras», generates a pairing code and a simulated
 * agent redeems it through the api (the real agent is a separate program). Without the agent's socket the
 * computer stays "Desconectado" with no printers, so this covers pairing, renaming and unpairing only.
 * Registers 1 user (the owner) and redeems 1 pairing code (5/min per IP).
 */
test.describe.configure({ mode: "serial", timeout: 120_000 });

const id = runId();
const ownerEmail = uniqueEmail("printers-owner");

test("the owner pairs a computer with a code, renames it and unpairs it", async ({ browser }) => {
  const owner = await browser.newContext(CONTEXT_OPTIONS);
  // The agent: no session cookie and no browser Origin, like the Windows program.
  const agent = await request.newContext({ baseURL: BASE_URL, ignoreHTTPSErrors: true });
  try {
    await registerViaApi(owner.request, { name: "Pía Dueña", email: ownerEmail });
    await verifyEmailViaApi(owner.request, ownerEmail);
    const created = await owner.request.post("/api/restaurants", { data: { name: `Picada ${id}` }, headers: ORIGIN_HEADER });
    expect(created.status(), await created.text()).toBe(201);
    const restaurantId = String(((await created.json()) as { id: string }).id);

    const page = await owner.newPage();
    await page.goto(`/admin/${restaurantId}/impresoras`);
    await waitForHydration(page);
    await expect(page.getByRole("heading", { name: "Impresoras", level: 2 })).toBeVisible();
    await expect(page.getByText("Todavía no hay computadores vinculados")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Trabajos con error" })).toBeVisible();
    await expect(page.getByTestId("no-failed-jobs")).toBeVisible();

    // The code, shown as "XXXX-XXXX" with its countdown.
    await page.getByTestId("pairing-generate").click();
    const codeText = (await page.getByTestId("pairing-code").textContent())?.trim() ?? "";
    expect(codeText).toMatch(/^[2-9A-Z]{4}-[2-9A-Z]{4}$/);
    await expect(page.getByText(/Vence en \d+:\d{2}/)).toBeVisible();

    // The agent redeems it (dashes are ignored); the screen notices on its own and lists the computer.
    const paired = await agent.post("/api/print-agents/pair", { data: { code: codeText, name: "PC Cocina", appVersion: "1.0.0" } });
    expect(paired.status(), await paired.text()).toBe(201);
    expect(await paired.json()).toMatchObject({ restaurantName: `Picada ${id}` });

    const computer = page.getByTestId("print-agent");
    await expect(computer).toHaveCount(1, { timeout: 15_000 });
    await expect(page.getByTestId("pairing-code")).toHaveCount(0);
    await expect(computer.getByTestId("print-agent-name")).toHaveText("PC Cocina");
    await expect(computer.getByTestId("print-agent-status")).toContainText("Desconectado");
    await expect(computer).toContainText("Versión 1.0.0");
    await expect(computer.getByTestId("no-printers")).toBeVisible();

    // A used code cannot pair a second computer.
    const reused = await agent.post("/api/print-agents/pair", { data: { code: codeText, name: "Otro", appVersion: "1.0.0" } });
    expect(reused.status()).toBe(400);

    // Rename.
    await computer.getByRole("button", { name: "Renombrar «PC Cocina»" }).click();
    const rename = page.getByRole("dialog", { name: "Renombrar equipo" });
    await rename.getByLabel("Nombre").fill("Cocina caliente");
    await rename.getByRole("button", { name: "Guardar" }).click();
    await expect(rename).toBeHidden();
    await expect(computer.getByTestId("print-agent-name")).toHaveText("Cocina caliente");

    // After a reload too (saved on the server).
    await page.reload();
    await waitForHydration(page);
    await expect(page.getByTestId("print-agent-name")).toHaveText("Cocina caliente");

    // Unpair.
    await page.getByRole("button", { name: "Desvincular «Cocina caliente»" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Desvincular" }).click();
    await expect(page.getByTestId("print-agent")).toHaveCount(0);
    await expect(page.getByText("Todavía no hay computadores vinculados")).toBeVisible();

    // The board does not announce a kitchen printer.
    await page.goto(`/admin/${restaurantId}/pedidos`);
    await waitForHydration(page);
    await expect(page.getByTestId("live-badge")).toBeVisible();
    await expect(page.getByTestId("print-agent-banner")).toHaveCount(0);
  } finally {
    await agent.dispose();
    await owner.close();
  }
});
