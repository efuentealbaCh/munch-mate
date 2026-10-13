import type {
  AdminMenuView,
  ChangeOrderStatusInput,
  CreatedOrder,
  CreateDeliveryOrderInput,
  CreateTablePaymentInput,
  CreateDineInOrderInput,
  CreatePickupOrderInput,
  CustomerOrdersPage,
  DailySummary,
  DeliveryZoneInput,
  DeliveryZoneView,
  EditOrderItemsInput,
  GeoPoint,
  InvitationPreview,
  InvitationView,
  MapConfig,
  MessagingSettings,
  MemberView,
  MenuCategoryView,
  ModifierGroupView,
  OrderStatus,
  OrderView,
  PaymentMethod,
  PlatformRestaurantPage,
  ProductPromo,
  ProductView,
  PublicTableBill,
  ProfileInput,
  PublicDeliveryZone,
  PublicMenu,
  PublicOrderView,
  PushConfig,
  PushSubscriptionInput,
  RestaurantRole,
  RestaurantStatus,
  RestaurantView,
  RiderPosition,
  RiderView,
  SalesExportKind,
  SalesReport,
  SavedAddressInput,
  SavedAddressView,
  SetTableSplitInput,
  SlugAvailability,
  TableContext,
  TableSessionView,
  TableView,
  TipChoice,
  UserProfile,
  WeeklyHours,
} from "@app/types";
import { api } from "./api";
import { type DownloadedFile, filenameFromDisposition } from "./download";

/** Typed wrappers for every api endpoint the web uses. Paths are relative to /api. */

export const authApi = {
  me: () => api.request<UserProfile>("/auth/me"),
  register: (body: { name: string; email: string; password: string }) =>
    api.request<UserProfile>("/auth/register", { method: "POST", body }),
  login: (body: { email: string; password: string }) =>
    api.request<UserProfile>("/auth/login", { method: "POST", body }),
  logout: () => api.request<void>("/auth/logout", { method: "POST" }),
  verifyEmail: (token: string) => api.request<void>("/auth/verify-email", { method: "POST", body: { token } }),
  resendVerification: () => api.request<void>("/auth/resend-verification", { method: "POST" }),
  forgotPassword: (email: string) => api.request<void>("/auth/forgot-password", { method: "POST", body: { email } }),
  resetPassword: (token: string, password: string) =>
    api.request<void>("/auth/reset-password", { method: "POST", body: { token, password } }),
};

const restaurantPath = (id: string) => `/restaurants/${encodeURIComponent(id)}`;

/** Multipart body for image uploads: one field named `file` (what the api's ImageUpload expects). */
function imageForm(file: File): FormData {
  const form = new FormData();
  form.append("file", file);
  return form;
}

export const restaurantsApi = {
  list: () => api.request<RestaurantView[]>("/restaurants"),
  get: (id: string, signal?: AbortSignal) => api.request<RestaurantView>(restaurantPath(id), { signal }),
  create: (body: { name: string; slug: string }) =>
    api.request<RestaurantView>("/restaurants", { method: "POST", body }),
  /**
   * pickupEnabled / deliveryEnabled: let customers order for pickup / delivery from the public menu (owner).
   * maxItemsPerOrder: cap on units per order (owner).
   */
  update: (
    id: string,
    body: {
      name?: string;
      slug?: string;
      description?: string;
      phone?: string;
      pickupEnabled?: boolean;
      deliveryEnabled?: boolean;
      /** Units (sum of quantities) allowed in one order, ORDER_LIMITS.itemsPerOrderMin…Max. */
      maxItemsPerOrder?: number;
      /** The restaurant on the map (centers the maps); null removes it. */
      location?: GeoPoint | null;
      /** Suggested tip on table bills, percent (0 = none). */
      tipPercent?: number;
      /** WhatsApp/SMS notices. @throws ApiError SENDER_PHONE_REQUIRED, INVALID_SENDER_PHONE (400). */
      messaging?: MessagingSettings;
    },
  ) =>
    api.request<RestaurantView>(restaurantPath(id), { method: "PATCH", body }),
  setLogo: (id: string, file: File) =>
    api.request<RestaurantView>(`${restaurantPath(id)}/logo`, { method: "PUT", body: imageForm(file) }),
  removeLogo: (id: string) => api.request<RestaurantView>(`${restaurantPath(id)}/logo`, { method: "DELETE" }),
  /** Opens/closes the restaurant for orders (owner, cashier, kitchen). */
  setAcceptingOrders: (id: string, acceptingOrders: boolean) =>
    api.request<RestaurantView>(`${restaurantPath(id)}/accepting-orders`, { method: "PUT", body: { acceptingOrders } }),
  /**
   * Weekly opening hours (owner); null removes the schedule (only the manual switch decides).
   * @throws ApiError INVALID_OPENING_HOURS (400).
   */
  setOpeningHours: (id: string, openingHours: WeeklyHours | null) =>
    api.request<RestaurantView>(`${restaurantPath(id)}/opening-hours`, { method: "PUT", body: { openingHours } }),
  slugAvailability: (slug: string, signal?: AbortSignal) =>
    api.request<SlugAvailability>(`/restaurants/slug-availability?slug=${encodeURIComponent(slug)}`, { signal }),
};

export const teamApi = {
  members: (restaurantId: string) => api.request<MemberView[]>(`${restaurantPath(restaurantId)}/members`),
  updateRoles: (restaurantId: string, userId: string, roles: RestaurantRole[]) =>
    api.request<void>(`${restaurantPath(restaurantId)}/members/${encodeURIComponent(userId)}`, {
      method: "PATCH",
      body: { roles },
    }),
  removeMember: (restaurantId: string, userId: string) =>
    api.request<void>(`${restaurantPath(restaurantId)}/members/${encodeURIComponent(userId)}`, { method: "DELETE" }),
  invitations: (restaurantId: string) =>
    api.request<InvitationView[]>(`${restaurantPath(restaurantId)}/invitations`),
  invite: (restaurantId: string, body: { email: string; roles: RestaurantRole[] }) =>
    api.request<InvitationView>(`${restaurantPath(restaurantId)}/invitations`, { method: "POST", body }),
  revokeInvitation: (restaurantId: string, invitationId: string) =>
    api.request<void>(`${restaurantPath(restaurantId)}/invitations/${encodeURIComponent(invitationId)}`, {
      method: "DELETE",
    }),
};

export const invitationsApi = {
  preview: (token: string) => api.request<InvitationPreview>("/invitations/preview", { method: "POST", body: { token } }),
  accept: (token: string) => api.request<RestaurantView>("/invitations/accept", { method: "POST", body: { token } }),
};

const menuPath = (restaurantId: string) => `${restaurantPath(restaurantId)}/menu`;
const segment = encodeURIComponent;

export interface ProductInput {
  categoryId: string;
  name: string;
  description: string;
  price: number;
  visible: boolean;
  modifierGroupIds: string[];
}

export interface ModifierGroupInput {
  name: string;
  minSelect: number;
  maxSelect: number;
  /** `id` keeps an existing option (and its availability); options without it are created. */
  options: Array<{ id?: string; name: string; priceDelta: number; available: boolean }>;
}

/** Menu administration. Reading: any member; availability: owner/cashier/kitchen; the rest: owner. */
export const menuApi = {
  get: (restaurantId: string) => api.request<AdminMenuView>(menuPath(restaurantId)),

  createCategory: (restaurantId: string, body: { name: string; description: string }) =>
    api.request<MenuCategoryView>(`${menuPath(restaurantId)}/categories`, { method: "POST", body }),
  updateCategory: (
    restaurantId: string,
    categoryId: string,
    body: { name?: string; description?: string; active?: boolean },
  ) =>
    api.request<MenuCategoryView>(`${menuPath(restaurantId)}/categories/${segment(categoryId)}`, {
      method: "PATCH",
      body,
    }),
  deleteCategory: (restaurantId: string, categoryId: string) =>
    api.request<void>(`${menuPath(restaurantId)}/categories/${segment(categoryId)}`, { method: "DELETE" }),
  /** `ids` must contain every category exactly once. */
  reorderCategories: (restaurantId: string, ids: string[]) =>
    api.request<MenuCategoryView[]>(`${menuPath(restaurantId)}/categories/order`, { method: "PUT", body: { ids } }),
  /** `ids` must contain every product of the category exactly once. */
  reorderProducts: (restaurantId: string, categoryId: string, ids: string[]) =>
    api.request<void>(`${menuPath(restaurantId)}/categories/${segment(categoryId)}/products/order`, {
      method: "PUT",
      body: { ids },
    }),

  createProduct: (restaurantId: string, body: ProductInput) =>
    api.request<ProductView>(`${menuPath(restaurantId)}/products`, { method: "POST", body }),
  /** Partial update; moving to another category appends the product at its end. */
  updateProduct: (restaurantId: string, productId: string, body: Partial<ProductInput>) =>
    api.request<ProductView>(`${menuPath(restaurantId)}/products/${segment(productId)}`, { method: "PATCH", body }),
  deleteProduct: (restaurantId: string, productId: string) =>
    api.request<void>(`${menuPath(restaurantId)}/products/${segment(productId)}`, { method: "DELETE" }),
  setProductAvailability: (restaurantId: string, productId: string, available: boolean) =>
    api.request<void>(`${menuPath(restaurantId)}/products/${segment(productId)}/availability`, {
      method: "PATCH",
      body: { available },
    }),
  setProductImage: (restaurantId: string, productId: string, file: File) =>
    api.request<ProductView>(`${menuPath(restaurantId)}/products/${segment(productId)}/image`, {
      method: "PUT",
      body: imageForm(file),
    }),
  removeProductImage: (restaurantId: string, productId: string) =>
    api.request<ProductView>(`${menuPath(restaurantId)}/products/${segment(productId)}/image`, { method: "DELETE" }),

  createModifierGroup: (restaurantId: string, body: ModifierGroupInput) =>
    api.request<ModifierGroupView>(`${menuPath(restaurantId)}/modifier-groups`, { method: "POST", body }),
  /** Full replacement (send every option). */
  replaceModifierGroup: (restaurantId: string, groupId: string, body: ModifierGroupInput) =>
    api.request<ModifierGroupView>(`${menuPath(restaurantId)}/modifier-groups/${segment(groupId)}`, {
      method: "PUT",
      body,
    }),
  deleteModifierGroup: (restaurantId: string, groupId: string) =>
    api.request<void>(`${menuPath(restaurantId)}/modifier-groups/${segment(groupId)}`, { method: "DELETE" }),
  /** Discount of a product (owner). @throws ApiError INVALID_PROMO (400, `meta.problem`). */
  setProductPromo: (restaurantId: string, productId: string, promo: ProductPromo) =>
    api.request<ProductView>(`${menuPath(restaurantId)}/products/${segment(productId)}/promo`, { method: "PUT", body: promo }),
  removeProductPromo: (restaurantId: string, productId: string) =>
    api.request<ProductView>(`${menuPath(restaurantId)}/products/${segment(productId)}/promo`, { method: "DELETE" }),
  setOptionAvailability: (restaurantId: string, groupId: string, optionId: string, available: boolean) =>
    api.request<void>(
      `${menuPath(restaurantId)}/modifier-groups/${segment(groupId)}/options/${segment(optionId)}/availability`,
      { method: "PATCH", body: { available } },
    ),
};

/** Staff side of orders (owner, cashier, kitchen; payments and rider assignment: owner, cashier). */
export const ordersApi = {
  /** active = not final, oldest first; today = this business day, newest first. */
  list: (restaurantId: string, scope: "active" | "today") =>
    api.request<OrderView[]>(`${restaurantPath(restaurantId)}/orders?scope=${scope}`),
  get: (restaurantId: string, orderId: string) =>
    api.request<OrderView>(`${restaurantPath(restaurantId)}/orders/${segment(orderId)}`),
  /**
   * @param extra `reason` when rejecting; `readyInMinutes` when accepting a pickup or delivery order (the
   *   choices of its channel, READY_MINUTES_BY_CHANNEL).
   * @throws ApiError INVALID_TRANSITION / ORDER_CHANGED (409), REASON_REQUIRED / READY_TIME_REQUIRED (400),
   *   FORBIDDEN_ROLE (403).
   */
  changeStatus: (
    restaurantId: string,
    orderId: string,
    status: OrderStatus,
    extra: { reason?: string; readyInMinutes?: number } = {},
  ) => {
    const body: ChangeOrderStatusInput = { status };
    if (extra.reason) body.reason = extra.reason;
    if (extra.readyInMinutes) body.readyInMinutes = extra.readyInMinutes;
    return api.request<OrderView>(`${restaurantPath(restaurantId)}/orders/${segment(orderId)}/status`, {
      method: "POST",
      body,
    });
  },
  markPaid: (restaurantId: string, orderId: string, method: PaymentMethod) =>
    api.request<OrderView>(`${restaurantPath(restaurantId)}/orders/${segment(orderId)}/payment`, {
      method: "POST",
      body: { method },
    }),
  /**
   * Assigns a delivery to a rider; null unassigns it.
   * @throws ApiError NOT_A_RIDER (400), ORDER_NOT_FOUND (404, also once the order is over).
   */
  assignRider: (restaurantId: string, orderId: string, riderId: string | null) =>
    api.request<OrderView>(`${restaurantPath(restaurantId)}/orders/${segment(orderId)}/rider`, {
      method: "PUT",
      body: { riderId },
    }),
  /**
   * Changes the items of an order before the kitchen starts it (lines not in `keep` are removed; `add` is
   * priced against the current menu). Staff with the roles of the order's channel.
   * @throws ApiError ORDER_NOT_EDITABLE / ORDER_ALREADY_PAID / ORDER_CHANGED / TOO_MANY_ITEMS (`meta.max`) /
   *   BELOW_MINIMUM_ORDER / sold-out codes (`meta.productId`) (409), INVALID_EDIT / ORDER_EMPTY / NOTHING_CHANGED
   *   (400), FORBIDDEN_ROLE (403), ORDER_NOT_FOUND (404).
   */
  editItems: (restaurantId: string, orderId: string, body: EditOrderItemsInput) =>
    api.request<OrderView>(`${restaurantPath(restaurantId)}/orders/${segment(orderId)}/items`, { method: "PUT", body }),
  /** Members with the rider role (owner, cashier). */
  riders:(restaurantId: string) => api.request<RiderView[]>(`${restaurantPath(restaurantId)}/riders`),
  /**
   * Receipt PDF of a pickup or delivery order.
   * @returns The file, or null while the workers are still generating it (202).
   * @throws ApiError RECEIPT_NOT_FOUND (the order has none: dine-in, or never accepted).
   */
  receipt: (restaurantId: string, orderId: string) =>
    readReceipt(api.requestResponse(`${restaurantPath(restaurantId)}/orders/${segment(orderId)}/receipt`)),
  /** Last position of the rider of a delivery on its way (null: not on its way, or no report yet). */
  riderLocation: (restaurantId: string, orderId: string, signal?: AbortSignal) =>
    api.request<{ position: RiderPosition | null }>(`${restaurantPath(restaurantId)}/orders/${segment(orderId)}/rider-location`, {
      signal,
    }),
};

async function readReceipt(pending: Promise<Response>): Promise<DownloadedFile | null> {
  const response = await pending;
  if (response.status === 202) return null;
  return {
    blob: await response.blob(),
    filename: filenameFromDisposition(response.headers.get("Content-Disposition"), "comprobante.pdf"),
  };
}

/** Sales reports (owner, cashier). */
export const reportsApi = {
  /** @param date Business date YYYY-MM-DD in the restaurant's zone (omitted = today). */
  daily: (restaurantId: string, date?: string, signal?: AbortSignal) =>
    api.request<DailySummary>(
      `${restaurantPath(restaurantId)}/reports/daily${date ? `?date=${encodeURIComponent(date)}` : ""}`,
      { signal },
    ),
  /**
   * Sales between two business days (inclusive), one row per day.
   * @throws ApiError INVALID_RANGE, RANGE_TOO_LONG, INVALID_DATE, FUTURE_DATE (400).
   */
  sales: (restaurantId: string, from: string, to: string, signal?: AbortSignal) =>
    api.request<SalesReport>(
      `${restaurantPath(restaurantId)}/reports/sales?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      { signal },
    ),
  /** CSV for Excel (`;`, UTF-8 with BOM): one row per order, product or day. */
  async salesCsv(restaurantId: string, from: string, to: string, kind: SalesExportKind): Promise<DownloadedFile> {
    const query = new URLSearchParams({ from, to, kind });
    const response = await api.requestResponse(`${restaurantPath(restaurantId)}/reports/sales.csv?${query}`);
    return {
      blob: await response.blob(),
      filename: filenameFromDisposition(response.headers.get("Content-Disposition"), `ventas-${from}.csv`),
    };
  },
};

/** The floor (phase 8): open table accounts, calls, charging a table. Owner, cashier and waiters. */
export const tableSessionsApi = {
  list: (restaurantId: string) => api.request<TableSessionView[]>(`${restaurantPath(restaurantId)}/table-sessions`),
  /** The call (or the bill request) was attended: the alert leaves every screen. */
  attend: (restaurantId: string, sessionId: string, kind: "waiter" | "bill") =>
    api.request<TableSessionView>(`${restaurantPath(restaurantId)}/table-sessions/${segment(sessionId)}/attend`, {
      method: "POST",
      body: { kind },
    }),
  /** One account (open or just closed): what the charge dialog reads again after a conflict. */
  get: (restaurantId: string, sessionId: string) =>
    api.request<TableSessionView>(`${restaurantPath(restaurantId)}/table-sessions/${segment(sessionId)}`),
  /**
   * Charges what is left of the account as one payment with `method` and the tip, and closes it ("Todo junto").
   * @throws ApiError TABLE_ORDERS_IN_PROGRESS (409), TABLE_OVERPAID (409: delete a payment first),
   *   TABLE_SESSION_NOT_FOUND (404: already charged).
   */
  close: (restaurantId: string, sessionId: string, body: { method: PaymentMethod; tip: number }) =>
    api.request<TableSessionView>(`${restaurantPath(restaurantId)}/table-sessions/${segment(sessionId)}/close`, {
      method: "POST",
      body,
    }),
  /**
   * Sets how the account is split (`{ mode: null }` removes the plan); the table's phones see it.
   * @throws ApiError INVALID_SPLIT_PARTS (400), SPLIT_PARTS_PAID (409), TABLE_SESSION_CHANGED (409).
   */
  setSplit: (restaurantId: string, sessionId: string, body: SetTableSplitInput) =>
    api.request<TableSessionView>(`${restaurantPath(restaurantId)}/table-sessions/${segment(sessionId)}/split`, {
      method: "PUT",
      body,
    }),
  /**
   * Registers a partial payment (the api computes equal parts and products). The one that completes the bill
   * closes the account: the answer then has `status: "closed"`.
   * @throws ApiError TABLE_ORDERS_IN_PROGRESS, PAYMENT_EXCEEDS_BALANCE, SPLIT_PART_PAID, TABLE_SESSION_CHANGED (409),
   *   INVALID_SPLIT_ITEMS, INVALID_AMOUNT, INVALID_TIP (400), TABLE_SESSION_NOT_FOUND (404).
   */
  addPayment: (restaurantId: string, sessionId: string, body: CreateTablePaymentInput) =>
    api.request<TableSessionView>(`${restaurantPath(restaurantId)}/table-sessions/${segment(sessionId)}/payments`, {
      method: "POST",
      body,
    }),
  /** Cancels a payment of an open account. @throws ApiError TABLE_SESSION_CLOSED (409), TABLE_PAYMENT_NOT_FOUND (404). */
  deletePayment: (restaurantId: string, sessionId: string, paymentId: string) =>
    api.request<TableSessionView>(
      `${restaurantPath(restaurantId)}/table-sessions/${segment(sessionId)}/payments/${segment(paymentId)}`,
      { method: "DELETE" },
    ),
};

/** Platform administration (platformRole "admin"; anyone else gets 404 NOT_FOUND). */
export const platformApi = {
  /** 25 per page, newest first. @param page 1-based. */
  restaurants: (params: { q?: string; status?: RestaurantStatus; page?: number }, signal?: AbortSignal) => {
    const query = new URLSearchParams();
    if (params.q) query.set("q", params.q);
    if (params.status) query.set("status", params.status);
    if (params.page && params.page > 1) query.set("page", String(params.page));
    const search = query.toString();
    return api.request<PlatformRestaurantPage>(`/platform/restaurants${search ? `?${search}` : ""}`, { signal });
  },
  setStatus: (restaurantId: string, status: RestaurantStatus) =>
    api.request<void>(`/platform/restaurants/${encodeURIComponent(restaurantId)}/status`, { method: "PUT", body: { status } }),
};

const deliveriesPath = (restaurantId: string) => `${restaurantPath(restaurantId)}/deliveries`;

/**
 * The rider's own deliveries (rider role). Any other order answers 403 NOT_YOUR_DELIVERY.
 */
export const deliveriesApi = {
  /** Deliveries assigned to me that are still in progress. */
  list: (restaurantId: string) => api.request<OrderView[]>(deliveriesPath(restaurantId)),
  /** out_for_delivery or delivered. @throws ApiError NOT_YOUR_DELIVERY (403), ORDER_CHANGED / INVALID_TRANSITION (409). */
  changeStatus: (restaurantId: string, orderId: string, status: Extract<OrderStatus, "out_for_delivery" | "delivered">) =>
    api.request<OrderView>(`${deliveriesPath(restaurantId)}/${segment(orderId)}/status`, {
      method: "POST",
      body: { status } satisfies ChangeOrderStatusInput,
    }),
  /** Payment collected at the door. */
  markPaid: (restaurantId: string, orderId: string, method: PaymentMethod) =>
    api.request<OrderView>(`${deliveriesPath(restaurantId)}/${segment(orderId)}/payment`, {
      method: "POST",
      body: { method },
    }),
};

const zonesPath = (restaurantId: string) => `${restaurantPath(restaurantId)}/delivery-zones`;

/** Delivery zones (owner manages; any member reads). */
export const deliveryZonesApi = {
  list: (restaurantId: string) => api.request<DeliveryZoneView[]>(zonesPath(restaurantId)),
  /** @throws ApiError ZONES_LIMIT (409). Marking it isHome unmarks the previous home zone. */
  create: (restaurantId: string, body: DeliveryZoneInput) =>
    api.request<DeliveryZoneView>(zonesPath(restaurantId), { method: "POST", body }),
  update: (restaurantId: string, zoneId: string, body: Partial<DeliveryZoneInput>) =>
    api.request<DeliveryZoneView>(`${zonesPath(restaurantId)}/${segment(zoneId)}`, { method: "PATCH", body }),
  delete: (restaurantId: string, zoneId: string) =>
    api.request<void>(`${zonesPath(restaurantId)}/${segment(zoneId)}`, { method: "DELETE" }),
};

const tablesPath = (restaurantId: string) => `${restaurantPath(restaurantId)}/tables`;

/** Table management (owner; the list is also readable by cashier and kitchen). */
export const tablesApi = {
  list: (restaurantId: string) => api.request<TableView[]>(tablesPath(restaurantId)),
  create: (restaurantId: string, label: string) =>
    api.request<TableView>(tablesPath(restaurantId), { method: "POST", body: { label } }),
  update: (restaurantId: string, tableId: string, body: { label?: string; active?: boolean }) =>
    api.request<TableView>(`${tablesPath(restaurantId)}/${segment(tableId)}`, { method: "PATCH", body }),
  delete: (restaurantId: string, tableId: string) =>
    api.request<void>(`${tablesPath(restaurantId)}/${segment(tableId)}`, { method: "DELETE" }),
  /** The old QR stops working at once. */
  regenerateToken: (restaurantId: string, tableId: string) =>
    api.request<TableView>(`${tablesPath(restaurantId)}/${segment(tableId)}/regenerate-token`, { method: "POST" }),
  /** Starts the PDF with every active table's QR. @throws ApiError NO_ACTIVE_TABLES. */
  requestQrSheet: (restaurantId: string) =>
    api.request<{ jobId: string }>(`${tablesPath(restaurantId)}/qr-sheet`, { method: "POST" }),
  /**
   * @returns The PDF once ready, or null while the workers are still generating it (202).
   * @throws ApiError QR_SHEET_NOT_FOUND, QR_SHEET_FAILED.
   */
  async qrSheet(restaurantId: string, jobId: string): Promise<Blob | null> {
    const response = await api.requestResponse(`${tablesPath(restaurantId)}/qr-sheet/${segment(jobId)}`);
    if (response.status === 202) return null;
    return response.blob();
  },
};

/** Customer side (no session). Tracking tokens travel in the body, never in the URL. */
export const publicOrdersApi = {
  create: (tableToken: string, body: CreateDineInOrderInput) =>
    api.request<CreatedOrder>(`/public/tables/${segment(tableToken)}/orders`, { method: "POST", body }),
  /**
   * Pickup order from the public menu.
   * @throws ApiError PICKUP_DISABLED / NOT_ACCEPTING_ORDERS / sold-out codes (409), INVALID_PHONE (400),
   *   TOO_MANY_ACTIVE_ORDERS (429, with its own message), MENU_NOT_FOUND (404).
   */
  createPickup: (slug: string, body: CreatePickupOrderInput) =>
    api.request<CreatedOrder>(`/public/restaurants/${segment(slug)}/orders`, { method: "POST", body }),
  /**
   * Delivery order from the public menu.
   * @throws ApiError DELIVERY_DISABLED / ZONE_NOT_AVAILABLE / BELOW_MINIMUM_ORDER / NOT_ACCEPTING_ORDERS /
   *   sold-out codes (409), CASH_AMOUNT_TOO_LOW / INVALID_PHONE (400), TOO_MANY_ACTIVE_ORDERS (429).
   */
  createDelivery: (slug: string, body: CreateDeliveryOrderInput) =>
    api.request<CreatedOrder>(`/public/restaurants/${segment(slug)}/delivery-orders`, { method: "POST", body }),
  /** Active zones, the restaurant's own first. @throws ApiError (404) when delivery is off. */
  deliveryZones: (slug: string) => api.request<PublicDeliveryZone[]>(`/public/restaurants/${segment(slug)}/delivery-zones`),
  /**
   * The zone whose area contains the pin (first in display order when areas overlap).
   * @throws ApiError OUT_OF_DELIVERY_AREA (404) when no drawn zone contains it.
   */
  locateZone: (slug: string, point: GeoPoint, signal?: AbortSignal) =>
    api.request<PublicDeliveryZone>(`/public/restaurants/${segment(slug)}/delivery-zones/locate`, {
      method: "POST",
      body: { lat: point.lat, lng: point.lng },
      signal,
    }),
  /** Last position of the rider (token in the body). null = not on its way yet, or no report yet. */
  riderLocation: (accessToken: string, signal?: AbortSignal) =>
    api.request<{ position: RiderPosition | null }>("/public/orders/rider-location", {
      method: "POST",
      body: { accessToken },
      signal,
    }),
  lookup: (accessToken: string) =>
    api.request<PublicOrderView>("/public/orders/lookup", { method: "POST", body: { accessToken } }),
  /** @throws ApiError ORDER_NOT_CANCELLABLE once the restaurant took the order. */
  cancel: (accessToken: string) =>
    api.request<PublicOrderView>("/public/orders/cancel", { method: "POST", body: { accessToken } }),
  /** Fresh menu after a sold-out error (the page itself is server-rendered). */
  menu: (slug: string) => api.request<PublicMenu>(`/public/restaurants/${segment(slug)}/menu`),
  table: (tableToken: string) => api.request<TableContext>(`/public/tables/${segment(tableToken)}`),
  /** The table's account (open, or just paid), from its QR. */
  tableBill: (tableToken: string, signal?: AbortSignal) =>
    api.request<PublicTableBill>(`/public/tables/${segment(tableToken)}/bill`, { signal }),
  callWaiter: (tableToken: string) =>
    api.request<PublicTableBill>(`/public/tables/${segment(tableToken)}/call-waiter`, { method: "POST" }),
  /** @throws ApiError NOTHING_TO_PAY (409), INVALID_TIP (400). */
  requestBill: (tableToken: string, tip: TipChoice) =>
    api.request<PublicTableBill>(`/public/tables/${segment(tableToken)}/request-bill`, { method: "POST", body: { tip } }),
  /** Receipt PDF (POST: the token stays out of the URL). @returns null while it is being generated (202). */
  receipt: (accessToken: string) =>
    readReceipt(api.requestResponse("/public/orders/receipt", { method: "POST", body: { accessToken } })),
};

/** Self-hosted base map (phase 7). */
export const mapsApi = {
  /** `available: false` until the map data is uploaded (`pnpm maps:init`): the pages work without a map. */
  config: () => api.request<MapConfig>("/public/map-config"),
};

/** The signed-in person as a customer (phase 6): profile, saved addresses and order history. */
export const customersApi = {
  /** @throws ApiError INVALID_PHONE (400). The phone is stored normalized; "" clears it. */
  updateProfile: (body: ProfileInput) => api.request<UserProfile>("/me", { method: "PATCH", body }),
  addresses: () => api.request<SavedAddressView[]>("/me/addresses"),
  /** @throws ApiError ADDRESSES_LIMIT / ADDRESS_LABEL_TAKEN (409). */
  createAddress: (body: SavedAddressInput) => api.request<SavedAddressView>("/me/addresses", { method: "POST", body }),
  /** Full replacement. @throws ApiError ADDRESS_LABEL_TAKEN (409). */
  updateAddress: (addressId: string, body: SavedAddressInput) =>
    api.request<SavedAddressView>(`/me/addresses/${segment(addressId)}`, { method: "PUT", body }),
  deleteAddress: (addressId: string) => api.request<void>(`/me/addresses/${segment(addressId)}`, { method: "DELETE" }),
  /** Newest first, CUSTOMER_LIMITS.ordersPageSize per page. @param before `nextBefore` of the previous page. */
  orders: (before?: string | null, signal?: AbortSignal) =>
    api.request<CustomerOrdersPage>(`/me/orders${before ? `?before=${encodeURIComponent(before)}` : ""}`, { signal }),
};

/**
 * Web push (phase 6). Every subscribe call can answer 400 PUSH_NOT_CONFIGURED (no VAPID keys on the server)
 * or 400 INVALID_PUSH_ENDPOINT (a browser whose push service is not supported).
 */
export const pushApi = {
  /** publicKey null = push is off on this server: hide everything about notifications. */
  config: () => api.request<PushConfig>("/public/push-config"),
  /** This device gets the account notifications (staff: new orders; riders: assigned deliveries). */
  subscribeDevice: (subscription: PushSubscriptionInput) =>
    api.request<void>("/me/push-subscriptions", { method: "POST", body: subscription }),
  unsubscribeDevice: (endpoint: string) => api.request<void>("/me/push-subscriptions", { method: "DELETE", body: { endpoint } }),
  /** "Avísame": this browser follows one order (guests too). @throws ApiError ORDER_FINISHED (409). */
  followOrder: (accessToken: string, subscription: PushSubscriptionInput) =>
    api.request<void>("/public/orders/push-subscription", { method: "POST", body: { accessToken, subscription } }),
};
