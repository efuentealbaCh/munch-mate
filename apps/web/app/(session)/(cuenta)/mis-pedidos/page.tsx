import type { Metadata } from "next";
import { OrdersHistory } from "./orders-history";

export const metadata: Metadata = { title: "Mis pedidos", robots: { index: false, follow: false } };

export default function MyOrdersPage() {
  return <OrdersHistory />;
}
