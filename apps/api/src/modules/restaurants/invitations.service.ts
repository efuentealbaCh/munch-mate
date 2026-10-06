import type { InvitationPreview, InvitationView, RestaurantRole, RestaurantView } from "@app/types";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectConnection } from "@nestjs/mongoose";
import type { Connection } from "mongoose";
import { generateToken, hashToken } from "../../common/crypto/tokens";
import { apiError } from "../../common/errors/api-error";
import type { ApiEnv } from "../../config/env.validation";
import { EmailQueue } from "../../infra/queue/email.queue";
import { ONE_TIME_TOKEN_TTL_MS } from "../auth/auth.constants";
import { UsersRepository } from "../users/users.repository";
import { InvitationsRepository } from "./invitations.repository";
import { MembershipsRepository } from "./memberships.repository";
import { toRestaurantView } from "./restaurant.views";
import { RestaurantsRepository } from "./restaurants.repository";

const invalidInvitation = () =>
  new BadRequestException(apiError("INVALID_TOKEN", "La invitación no es válida, ya se usó o expiró"));

@Injectable()
export class InvitationsService {
  private readonly appUrl: string;

  constructor(
    private readonly invitations: InvitationsRepository,
    private readonly memberships: MembershipsRepository,
    private readonly restaurants: RestaurantsRepository,
    private readonly users: UsersRepository,
    private readonly emails: EmailQueue,
    @InjectConnection() private readonly connection: Connection,
    config: ConfigService<ApiEnv, true>,
  ) {
    this.appUrl = config.get("APP_URL", { infer: true });
  }

  /**
   * Invites an email address with the given roles and emails the link. A newer invitation to the same
   * address replaces the previous one.
   * @throws ConflictException ALREADY_MEMBER.
   */
  async invite(
    restaurantId: string,
    inviterId: string,
    input: { email: string; roles: RestaurantRole[] },
  ): Promise<InvitationView> {
    const existingUser = await this.users.findByEmail(input.email);
    if (existingUser && (await this.memberships.findOne(restaurantId, existingUser.id))) {
      throw new ConflictException(
        apiError("ALREADY_MEMBER", "Esa persona ya es parte del equipo; cambia sus roles en la lista"),
      );
    }

    const [restaurant, inviter] = await Promise.all([
      this.restaurants.findById(restaurantId),
      this.users.findById(inviterId),
    ]);
    if (!restaurant || !inviter) throw new NotFoundException(apiError("RESTAURANT_NOT_FOUND", "Restaurante no encontrado"));

    await this.invitations.revokePendingForEmail(restaurantId, input.email);
    const token = generateToken();
    const invitation = await this.invitations.create(restaurantId, {
      email: input.email,
      roles: input.roles,
      tokenHash: hashToken(token),
      invitedBy: inviterId,
      expiresAt: new Date(Date.now() + ONE_TIME_TOKEN_TTL_MS),
    });

    await this.emails.send(
      {
        template: "staff-invitation",
        data: {
          to: input.email,
          restaurantName: restaurant.name,
          inviterName: inviter.name,
          roles: input.roles,
          url: `${this.appUrl}/invitacion?token=${token}`,
        },
      },
      `staff-invitation-${invitation.id}`,
    );

    return { ...toInvitationView(invitation), invitedByName: inviter.name };
  }

  async listPending(restaurantId: string): Promise<InvitationView[]> {
    const invitations = await this.invitations.listPending(restaurantId);
    const inviters = new Map(
      (await this.users.findByIds([...new Set(invitations.map((i) => i.invitedBy))])).map((u) => [u.id, u.name]),
    );
    return invitations.map((i) => ({ ...toInvitationView(i), invitedByName: inviters.get(i.invitedBy) ?? "" }));
  }

  /** @throws NotFoundException INVITATION_NOT_FOUND. */
  async revoke(restaurantId: string, invitationId: string): Promise<void> {
    if (!(await this.invitations.revoke(restaurantId, invitationId))) {
      throw new NotFoundException(apiError("INVITATION_NOT_FOUND", "La invitación no existe o ya no está pendiente"));
    }
  }

  /** What the invitee sees before accepting. Public: the token itself is the credential. */
  async preview(token: string): Promise<InvitationPreview> {
    const invitation = await this.invitations.findPendingByTokenHash(hashToken(token));
    const restaurant = invitation ? await this.restaurants.findById(invitation.restaurantId) : null;
    if (!invitation || !restaurant) throw invalidInvitation();
    return {
      restaurantName: restaurant.name,
      email: invitation.email,
      roles: invitation.roles,
      expiresAt: invitation.expiresAt.toISOString(),
    };
  }

  /**
   * Joins the restaurant with the invited roles (merged with existing ones). The logged-in user's email
   * must be the invited one; having received the link also verifies that email.
   * @throws BadRequestException INVALID_TOKEN, ForbiddenException INVITATION_EMAIL_MISMATCH.
   */
  async accept(token: string, userId: string): Promise<RestaurantView> {
    const invitation = await this.invitations.findPendingByTokenHash(hashToken(token));
    if (!invitation) throw invalidInvitation();

    const user = await this.users.findById(userId);
    if (!user || user.email !== invitation.email) {
      throw new ForbiddenException(
        apiError(
          "INVITATION_EMAIL_MISMATCH",
          `Esta invitación es para ${invitation.email}. Ingresa con esa cuenta para aceptarla.`,
        ),
      );
    }

    await this.connection.transaction(async (session) => {
      // Conditional update: if two requests accept the same link, only one gets here first.
      if (!(await this.invitations.markAccepted(invitation.id, userId, session))) throw invalidInvitation();
      await this.memberships.addRoles(invitation.restaurantId, userId, invitation.roles, session);
      await this.users.markEmailVerified(userId, session);
    });

    const [restaurant, membership] = await Promise.all([
      this.restaurants.findById(invitation.restaurantId),
      this.memberships.findOne(invitation.restaurantId, userId),
    ]);
    if (!restaurant || !membership) throw invalidInvitation();
    return toRestaurantView(restaurant, membership.roles);
  }
}

function toInvitationView(invitation: {
  id: string;
  email: string;
  roles: RestaurantRole[];
  expiresAt: Date;
}): Omit<InvitationView, "invitedByName"> {
  return {
    id: invitation.id,
    email: invitation.email,
    roles: invitation.roles,
    expiresAt: invitation.expiresAt.toISOString(),
  };
}
