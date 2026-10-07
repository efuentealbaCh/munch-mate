import type { Metadata } from "next";
import { AvailabilityView } from "./availability-view";

export const metadata: Metadata = { title: "Disponibilidad" };

export default function AvailabilityPage() {
  return <AvailabilityView />;
}
