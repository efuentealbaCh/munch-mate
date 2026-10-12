import type { GeoPoint } from "./geo";
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

/** "HH:MM" in the restaurant's timezone. A close not after the open ends the next day (19:00–01:00). */
export interface TimeRange {
  open: string;
  close: string;
}

/** Seven days, Monday first; each with up to `OPENING_HOURS_LIMITS.rangesPerDay` ranges ([] = closed). */
export type WeeklyHours = TimeRange[][];

export const OPENING_HOURS_LIMITS = { rangesPerDay: 2 } as const;

/** Index 0 = lunes, matching WeeklyHours. */
export const WEEKDAY_LABELS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"] as const;

/**
 * Whether customers can order right now: the manual switch AND (when a schedule is set) the opening hours.
 * Computed by the api at request time.
 */
export interface OpenState {
  /** Inside the opening hours (always true without a schedule). */
  openNow: boolean;
  /** When the schedule opens next (ISO), if closed by schedule. */
  nextOpeningAt: string | null;
}

/** A restaurant as seen by one of its members. */
export interface RestaurantView {
  id: string;
  name: string;
  slug: string;
  /** Short text shown under the name in the public menu. */
  description: string;
  phone: string;
  logo: LogoImage | null;
  /** Manual "open/closed" switch: customers can only place orders while true (and within opening hours). */
  acceptingOrders: boolean;
  /** null = no schedule (the manual switch alone decides). */
  openingHours: WeeklyHours | null;
  openState: OpenState;
  /** Owner setting: units (sum of quantities) allowed in one order. */
  maxItemsPerOrder: number;
  /** Where the restaurant is (owner sets it on the map); centers the maps. */
  location: GeoPoint | null;
  /** Customers may order for pickup from the public menu `/r/{slug}`. Owner setting, off by default. */
  pickupEnabled: boolean;
  /** Customers may order for delivery to the restaurant's zones. Owner setting, off by default. */
  deliveryEnabled: boolean;
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

// ── Platform admin ──────────────────────────────────────────────────────────

/** A restaurant as the platform admin sees it in the list. */
export interface PlatformRestaurantView {
  id: string;
  name: string;
  slug: string;
  status: RestaurantStatus;
  acceptingOrders: boolean;
  createdAt: string;
  owners: { name: string; email: string }[];
  members: number;
}

export interface PlatformRestaurantPage {
  items: PlatformRestaurantView[];
  total: number;
}
