import type {
  InvitationPreview,
  InvitationView,
  MemberView,
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

export const restaurantsApi = {
  list: () => api.request<RestaurantView[]>("/restaurants"),
  get: (id: string, signal?: AbortSignal) => api.request<RestaurantView>(restaurantPath(id), { signal }),
  create: (body: { name: string; slug: string }) =>
    api.request<RestaurantView>("/restaurants", { method: "POST", body }),
  update: (id: string, body: { name?: string; slug?: string }) =>
    api.request<RestaurantView>(restaurantPath(id), { method: "PATCH", body }),
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
