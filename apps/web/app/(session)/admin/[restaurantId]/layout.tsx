import type { ReactNode } from "react";
import { RestaurantShell } from "./restaurant-shell";

export default function RestaurantLayout({ children }: { children: ReactNode }) {
  return <RestaurantShell>{children}</RestaurantShell>;
}
