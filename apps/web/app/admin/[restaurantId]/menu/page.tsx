import type { Metadata } from "next";
import { MenuEditor } from "./menu-editor";

export const metadata: Metadata = { title: "Menú" };

export default function MenuPage() {
  return <MenuEditor />;
}
