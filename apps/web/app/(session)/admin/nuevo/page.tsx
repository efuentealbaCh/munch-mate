import type { Metadata } from "next";
import { NewRestaurantForm } from "./new-restaurant-form";

export const metadata: Metadata = { title: "Nuevo restaurante" };

export default function NewRestaurantPage() {
  return <NewRestaurantForm />;
}
