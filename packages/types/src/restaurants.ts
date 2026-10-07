import type { LogoImage } from "./menu";

/** Roles a user can hold inside one restaurant (stored in memberships). */
export const RESTAURANT_ROLES = ["owner", "cashier", "kitchen", "rider"] as const;
export type RestaurantRole = (typeof RESTAURANT_ROLES)[number];

/** Spanish labels for UI and emails. */
export const RESTAURANT_ROLE_LABELS: Record<RestaurantRole, string> = {
  owner: "Dueño",
  cashier: "Caja",
  kitchen: "Cocina",
  rider: "Repartidor",
};

export type RestaurantStatus = "active" | "suspended";

/** A restaurant as seen by one of its members. */
export interface RestaurantView {
  id: string;
  name: string;
  slug: string;
  /** Short text shown under the name in the public menu. */
  description: string;
  phone: string;
  logo: LogoImage | null;
  currency: string;
  timezone: string;
  status: RestaurantStatus;
  /** Roles of the requesting user in this restaurant. */
  myRoles: RestaurantRole[];
}

export interface SlugAvailability {
  /** The slug as it would be stored (normalized). */
  slug: string;
  available: boolean;
  /** Why it is not available. */
  reason?: "taken" | "too_short" | "too_long" | "invalid_characters" | "reserved";
  /** A free alternative when the requested one is taken. */
  suggestion?: string;
}

export interface MemberView {
  userId: string;
  name: string;
  email: string;
  roles: RestaurantRole[];
  joinedAt: string;
}

export interface InvitationView {
  id: string;
  email: string;
  roles: RestaurantRole[];
  invitedByName: string;
  expiresAt: string;
}

/** What the invitee sees before accepting (public, token-based). */
export interface InvitationPreview {
  restaurantName: string;
  email: string;
  roles: RestaurantRole[];
  expiresAt: string;
}
