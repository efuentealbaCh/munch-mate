import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { VerifiedEmailGuard } from "../auth/verified-email.guard";
import { UsersModule } from "../users/users.module";
import { InvitationsController, RestaurantInvitationsController } from "./invitations.controller";
import { InvitationsRepository } from "./invitations.repository";
import { InvitationsService } from "./invitations.service";
import { MembersController } from "./members.controller";
import { MembersService } from "./members.service";
import { MembershipsRepository } from "./memberships.repository";
import { RestaurantAccessGuard } from "./restaurant-access.guard";
import { RestaurantsController } from "./restaurants.controller";
import { RestaurantsRepository } from "./restaurants.repository";
import { RestaurantsService } from "./restaurants.service";
import { Invitation, InvitationSchema } from "./schemas/invitation.schema";
import { Membership, MembershipSchema } from "./schemas/membership.schema";
import { Restaurant, RestaurantSchema } from "./schemas/restaurant.schema";

/** Tenants: restaurants, their members and staff invitations. */
@Module({
  imports: [
    UsersModule,
    MongooseModule.forFeature([
      { name: Restaurant.name, schema: RestaurantSchema },
      { name: Membership.name, schema: MembershipSchema },
      { name: Invitation.name, schema: InvitationSchema },
    ]),
  ],
  controllers: [RestaurantsController, MembersController, RestaurantInvitationsController, InvitationsController],
  providers: [
    RestaurantsService,
    MembersService,
    InvitationsService,
    RestaurantsRepository,
    MembershipsRepository,
    InvitationsRepository,
    RestaurantAccessGuard,
    VerifiedEmailGuard,
  ],
  // Later modules (menu, orders) protect their routes with the same guard.
  exports: [RestaurantAccessGuard, MembershipsRepository, RestaurantsRepository],
})
export class RestaurantsModule {}
