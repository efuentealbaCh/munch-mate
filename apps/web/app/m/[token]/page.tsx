import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublicMenu } from "@/lib/public-menu";
import { getTableContext } from "@/lib/public-table";
import { TableOrdering } from "./table-ordering";

interface PageProps {
  params: Promise<{ token: string }>;
}

/*
 * Customer page behind a table QR. Rendered on every request (headers() makes it dynamic) like /r/[slug]:
 * table state and menu are always current and the visitor's IP reaches the api's per-IP rate limit.
 * The QR does not depend on the slug, so renaming the restaurant never breaks printed codes.
 */

async function load(token: string) {
  const table = await getTableContext(token);
  if (table.status !== "ok") return table;
  const menu = await getPublicMenu(table.table.restaurant.slug);
  if (menu.status !== "ok") return menu;
  return { status: "ok" as const, table: table.table, menu: menu.menu };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params;
  const result = await load(token);
  // Table codes are not for search engines (and a regenerated one must not linger in an index).
  const robots = { index: false, follow: false };
  if (result.status !== "ok") return { title: "Pedir en la mesa", robots };
  return { title: { absolute: `${result.table.restaurant.name} · ${result.table.tableLabel}` }, robots };
}

export default async function TablePage({ params }: PageProps) {
  const { token } = await params;
  const result = await load(token);
  if (result.status === "not_found") notFound();
  if (result.status === "busy") return <Busy />;
  return <TableOrdering tableToken={token} table={result.table} initialMenu={result.menu} />;
}

function Busy() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-2 px-4 text-center" role="alert">
      <h1 className="text-xl font-semibold">Hay muchas visitas en este momento</h1>
      <p className="text-muted-foreground">Espera un minuto y recarga la página para ver el menú.</p>
    </main>
  );
}
