"use client";

import type { RestaurantView } from "@app/types";
import { createContext, useContext } from "react";

export interface RestaurantContextValue {
  restaurant: RestaurantView;
  isOwner: boolean;
  /** Replaces the restaurant after a successful update. */
  setRestaurant(restaurant: RestaurantView): void;
  /** Reloads it from the api (e.g. after changing my own roles). */
  reload(): void;
}

export const RestaurantContext = createContext<RestaurantContextValue | null>(null);

/** Restaurant loaded by /admin/[restaurantId]/layout. @throws Error outside that layout. */
export function useRestaurant(): RestaurantContextValue {
  const context = useContext(RestaurantContext);
  if (!context) throw new Error("useRestaurant must be used inside the restaurant layout");
  return context;
}
