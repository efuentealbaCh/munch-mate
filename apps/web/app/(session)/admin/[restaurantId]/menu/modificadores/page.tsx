import type { Metadata } from "next";
import { ModifierLibrary } from "./modifier-library";

export const metadata: Metadata = { title: "Modificadores" };

export default function ModifiersPage() {
  return <ModifierLibrary />;
}
