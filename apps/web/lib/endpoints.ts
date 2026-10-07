import type {
  AdminMenuView,
  CreatedOrder,
  CreateDineInOrderInput,
  InvitationPreview,
  InvitationView,
  MemberView,
  MenuCategoryView,
  ModifierGroupView,
  OrderStatus,
  OrderView,
  PaymentMethod,
  ProductView,
  PublicMenu,
  PublicOrderView,
  RestaurantRole,
  RestaurantView,
  SlugAvailability,
  TableContext,
  TableView,
  UserProfile,
} from "@app/types";
import { api } from "./api";

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
  update: (id: string, body: { name?: string; slug?: string; description?: string; phone?: string }) =>
    api.request<RestaurantView>(restaurantPath(id), { method: "PATCH", body }),
  setLogo: (id: string, file: File) =>
    api.request<RestaurantView>(`${restaurantPath(id)}/logo`, { method: "PUT", body: imageForm(file) }),
  removeLogo: (id: string) => api.request<RestaurantView>(`${restaurantPath(id)}/logo`, { method: "DELETE" }),
  /** Opens/closes the restaurant for orders (owner, cashier, kitchen). */
  setAcceptingOrders: (id: string, acceptingOrders: boolean) =>
    api.request<RestaurantView>(`${restaurantPath(id)}/accepting-orders`, { method: "PUT", body: { acceptingOrders } }),
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
  setOptionAvailability: (restaurantId: string, groupId: string, optionId: string, available: boolean) =>
    api.request<void>(
      `${menuPath(restaurantId)}/modifier-groups/${segment(groupId)}/options/${segment(optionId)}/availability`,
      { method: "PATCH", body: { available } },
    ),
};

/** Staff side of orders (owner, cashier, kitchen; payments: owner, cashier). */
export const ordersApi = {
  /** active = not final, oldest first; today = this business day, newest first. */
  list: (restaurantId: string, scope: "active" | "today") =>
    api.request<OrderView[]>(`${restaurantPath(restaurantId)}/orders?scope=${scope}`),
  get: (restaurantId: string, orderId: string) =>
    api.request<OrderView>(`${restaurantPath(restaurantId)}/orders/${segment(orderId)}`),
  /** @throws ApiError INVALID_TRANSITION / ORDER_CHANGED (409), REASON_REQUIRED (400), FORBIDDEN_ROLE (403). */
  changeStatus: (restaurantId: string, orderId: string, status: OrderStatus, reason?: string) =>
    api.request<OrderView>(`${restaurantPath(restaurantId)}/orders/${segment(orderId)}/status`, {
      method: "POST",
      body: reason ? { status, reason } : { status },
    }),
  markPaid: (restaurantId: string, orderId: string, method: PaymentMethod) =>
    api.request<OrderView>(`${restaurantPath(restaurantId)}/orders/${segment(orderId)}/payment`, {
      method: "POST",
      body: { method },
    }),
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
  lookup: (accessToken: string) =>
    api.request<PublicOrderView>("/public/orders/lookup", { method: "POST", body: { accessToken } }),
  /** @throws ApiError ORDER_NOT_CANCELLABLE once the restaurant took the order. */
  cancel: (accessToken: string) =>
    api.request<PublicOrderView>("/public/orders/cancel", { method: "POST", body: { accessToken } }),
  /** Fresh menu after a sold-out error (the page itself is server-rendered). */
  menu: (slug: string) => api.request<PublicMenu>(`/public/restaurants/${segment(slug)}/menu`),
  table: (tableToken: string) => api.request<TableContext>(`/public/tables/${segment(tableToken)}`),
};
