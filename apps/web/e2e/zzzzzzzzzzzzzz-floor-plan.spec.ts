import { expect, type Page, test } from "@playwright/test";
import { CONTEXT_OPTIONS, ORIGIN_HEADER, registerViaApi, runId, uniqueEmail, verifyEmailViaApi, waitForHydration } from "./helpers";

/*
 * Floor plan editor (phase 9): the owner opens «Mesas → Plano del local», creates the default plan with her
 * 3 tables, moves one (select it, «Mover», tap a cell), saves and finds it in the same place after reloading;
 * dragging the kitchen over a table disables «Guardar». Registers 1 user (the owner).
 */
test.describe.configure({ mode: "serial", timeout: 120_000 });

const id = runId();
const ownerEmail = uniqueEmail("floor-plan-owner");

/** A table drawn on the grid (its accessible name starts with the label: "Mesa 1, cuadrada, 4 puestos"). */
const tableOnGrid = (page: Page, label: string) =>
  page.getByTestId("floor-grid").getByRole("button", { name: new RegExp(`^${label},`) });

test("the owner draws the plan, moves a table and saves it; an overlap cannot be saved", async ({ browser }) => {
  const owner = await browser.newContext(CONTEXT_OPTIONS);
  try {
    await registerViaApi(owner.request, { name: "Rosa Dueña", email: ownerEmail });
    await verifyEmailViaApi(owner.request, ownerEmail);
    const created = await owner.request.post("/api/restaurants", { data: { name: `Fuente ${id}` }, headers: ORIGIN_HEADER });
    expect(created.status(), await created.text()).toBe(201);
    const restaurantId = String(((await created.json()) as { id: string }).id);
    for (const label of ["Mesa 1", "Mesa 2", "Mesa 3"]) {
      const table = await owner.request.post(`/api/restaurants/${restaurantId}/tables`, { data: { label }, headers: ORIGIN_HEADER });
      expect(table.status(), await table.text()).toBe(201);
    }

    // From «Mesas» to the editor; the «Mesas» tab stays highlighted.
    const page = await owner.newPage();
    await page.goto(`/admin/${restaurantId}/mesas`);
    await waitForHydration(page);
    await page.getByTestId("floor-plan-link").click();
    await expect(page).toHaveURL(new RegExp(`/admin/${restaurantId}/mesas/plano$`));
    await expect(page.getByRole("navigation", { name: "Secciones del restaurante" }).getByRole("link", { name: "Mesas" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    // The default plan places the 3 active tables in the first row, one cell apart.
    await page.getByTestId("create-floor-plan").click();
    await expect(page.getByTestId("floor-grid")).toBeVisible();
    await expect(tableOnGrid(page, "Mesa 1")).toHaveAttribute("data-x", "1");
    await expect(tableOnGrid(page, "Mesa 3")).toHaveAttribute("data-x", "5");
    await expect(page.getByTestId("floor-status")).toHaveText("Tienes cambios sin guardar.");

    // Move «Mesa 1»: select it, «Mover», tap the destination cell.
    await tableOnGrid(page, "Mesa 1").click();
    const panel = page.getByTestId("floor-selection");
    await expect(panel.getByRole("heading", { name: "Mesa 1" })).toBeVisible();
    await panel.getByRole("button", { name: "Mover", exact: true }).click();
    await page.locator('[data-cell="6,4"]').click();
    await expect(tableOnGrid(page, "Mesa 1")).toHaveAttribute("data-x", "6");
    await expect(tableOnGrid(page, "Mesa 1")).toHaveAttribute("data-y", "4");

    await page.getByTestId("save-floor-plan").click();
    await expect(page.getByText("Plano guardado", { exact: true })).toBeVisible();
    await expect(page.getByTestId("floor-status")).toHaveText("Plano guardado.");
    await expect(page.getByTestId("save-floor-plan")).toBeDisabled();

    // Still there after reloading.
    await page.reload();
    await waitForHydration(page);
    await expect(tableOnGrid(page, "Mesa 1")).toHaveAttribute("data-x", "6");
    await expect(tableOnGrid(page, "Mesa 1")).toHaveAttribute("data-y", "4");

    // The kitchen (columns 10–13) moved 5 cells left covers «Mesa 3» (column 5): red cells, no saving.
    await page.getByTestId("floor-grid").getByRole("button", { name: /^Cocina,/ }).click();
    for (let i = 0; i < 5; i++) await panel.getByRole("button", { name: "Mover a la izquierda" }).click();
    await expect(page.getByTestId("floor-status")).toContainText("Hay elementos superpuestos en el plano");
    await expect(page.getByTestId("floor-conflict").first()).toBeVisible();
    await expect(page.getByTestId("save-floor-plan")).toBeDisabled();

    // Discarding goes back to the saved plan.
    await page.getByRole("button", { name: "Descartar cambios" }).click();
    await expect(page.getByTestId("floor-conflict")).toHaveCount(0);
    await expect(page.getByTestId("floor-status")).toHaveText("Plano guardado.");
  } finally {
    await owner.close();
  }
});
