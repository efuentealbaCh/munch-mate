import type { PushConfig } from "@app/types";
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Post } from "@nestjs/common";
import type { AuthUser } from "../auth/auth.types";
import { CurrentUser, Public } from "../auth/decorators";
import { PushEndpointDto, PushSubscriptionDto } from "./dto/push.dto";
import { PushService } from "./push.service";

/** A signed-in person's devices (staff: new orders; riders: assigned deliveries). */
@Controller("me/push-subscriptions")
export class PushSubscriptionsController {
  constructor(private readonly push: PushService) {}

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  async subscribe(@CurrentUser() user: AuthUser, @Body() dto: PushSubscriptionDto): Promise<void> {
    await this.push.subscribeUser(user.id, dto);
  }

  /** DELETE with a body: the endpoint is a long URL, not an id. */
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async unsubscribe(@CurrentUser() user: AuthUser, @Body() dto: PushEndpointDto): Promise<void> {
    await this.push.unsubscribeUser(user.id, dto.endpoint);
  }
}

@Controller("public/push-config")
export class PushConfigController {
  constructor(private readonly push: PushService) {}

  /** The VAPID public key browsers subscribe with (null: push not configured on this server). */
  @Public()
  @Get()
  config(): PushConfig {
    return this.push.config();
  }
}
