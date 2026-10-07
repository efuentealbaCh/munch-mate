import type {
  AdminMenuView,
  InvitationPreview,
  InvitationView,
  MemberView,
  MenuCategoryView,
  ModifierGroupView,
  ProductView,
  RestaurantRole,
  RestaurantView,
  SlugAvailability,
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
