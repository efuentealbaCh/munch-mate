import type { Metadata } from "next";
import { PrintersView } from "./printers-view";

export const metadata: Metadata = { title: "Impresoras" };

export default function PrintersPage() {
  return <PrintersView />;
}
