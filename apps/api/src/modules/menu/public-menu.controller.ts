import type { PublicMenu } from "@app/types";
import { Controller, Get, Header, Param } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Public } from "../auth/decorators";
import { PublicMenuService } from "./public-menu.service";

@Controller("public/restaurants")
export class PublicMenuController {
  constructor(private readonly menus: PublicMenuService) {}

  /** Customer-facing menu. A short cache keeps it cheap under load while edits still show within a minute. */
  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Get(":slug/menu")
  @Header("Cache-Control", "public, max-age=30, stale-while-revalidate=60")
  get(@Param("slug") slug: string): Promise<PublicMenu> {
    return this.menus.getBySlug(slug);
  }
}
