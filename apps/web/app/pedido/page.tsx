import type { Metadata } from "next";
import { OrderTracking } from "./order-tracking";

/*
 * Customer tracking page. The order's access token travels in the URL fragment (/pedido#t=…), which the
 * browser never sends to the server, so this page is static and everything happens client-side.
 */
export const metadata: Metadata = {
  title: "Tu pedido",
  robots: { index: false, follow: false },
};

export default function TrackingPage() {
  return <OrderTracking />;
}
