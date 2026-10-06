import type { Metadata } from "next";
import { RestaurantList } from "./restaurant-list";

export const metadata: Metadata = { title: "Mis restaurantes" };

export default function AdminHomePage() {
  return <RestaurantList />;
}
