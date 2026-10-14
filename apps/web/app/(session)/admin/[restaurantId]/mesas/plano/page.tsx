import type { Metadata } from "next";
import { FloorPlanPage } from "./floor-plan-editor";

export const metadata: Metadata = { title: "Plano del local" };

export default function FloorPlanRoute() {
  return <FloorPlanPage />;
}
