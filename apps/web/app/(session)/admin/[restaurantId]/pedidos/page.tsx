import type { Metadata } from "next";
import { OrdersView } from "./orders-view";

export const metadata: Metadata = { title: "Pedidos" };

export default function OrdersPage() {
  return <OrdersView />;
}
