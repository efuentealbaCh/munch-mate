import type { Metadata } from "next";
import { DeliveriesView } from "./deliveries-view";

export const metadata: Metadata = { title: "Repartos" };

export default function DeliveriesPage() {
  return <DeliveriesView />;
}
