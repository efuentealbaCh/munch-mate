import type { Metadata } from "next";
import { RestaurantOverview } from "./restaurant-overview";

export const metadata: Metadata = { title: "Resumen" };

export default function RestaurantPage() {
  return <RestaurantOverview />;
}
