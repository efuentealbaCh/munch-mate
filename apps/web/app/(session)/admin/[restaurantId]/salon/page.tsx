import type { Metadata } from "next";
import { SalonView } from "./salon-view";

export const metadata: Metadata = { title: "Salón" };

export default function SalonPage() {
  return <SalonView />;
}
