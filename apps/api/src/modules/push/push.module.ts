import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { RestaurantsModule } from "../restaurants/restaurants.module";
import { PushConfigController, PushSubscriptionsController } from "./push.controller";
import { PushSubscriptionsRepository } from "./push-subscriptions.repository";
import { PushService } from "./push.service";
import { PushSubscription, PushSubscriptionSchema } from "./schemas/push-subscription.schema";

/** Web push: subscriptions and order notifications (sent by the workers' notif queue). */
@Module({
  imports: [RestaurantsModule, MongooseModule.forFeature([{ name: PushSubscription.name, schema: PushSubscriptionSchema }])],
  controllers: [PushSubscriptionsController, PushConfigController],
  providers: [PushService, PushSubscriptionsRepository],
  exports: [PushService],
})
export class PushModule {}
