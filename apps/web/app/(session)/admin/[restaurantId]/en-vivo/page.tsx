import type { Metadata } from "next";
import { LiveView } from "./live-view";

export const metadata: Metadata = { title: "En vivo" };

export default function LivePage() {
  return <LiveView />;
}
