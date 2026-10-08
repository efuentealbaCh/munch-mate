import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { MongooseModule } from "@nestjs/mongoose";
import type { ApiEnv } from "../../config/env.validation";
import { UsersModule } from "../users/users.module";
import { AccessTokenGuard } from "./access-token.guard";
import { AccessTokenService } from "./access-token.service";
import { ACCESS_TOKEN_TTL_SECONDS } from "./auth.constants";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { OneTimeTokensRepository } from "./one-time-tokens.repository";
import { PasswordHasher } from "./password.hasher";
import { OneTimeToken, OneTimeTokenSchema } from "./schemas/one-time-token.schema";
import { Session, SessionSchema } from "./schemas/session.schema";
import { SessionCookies } from "./session-cookies";
import { SessionsRepository } from "./sessions.repository";

@Module({
  imports: [
    UsersModule,
    MongooseModule.forFeature([
      { name: Session.name, schema: SessionSchema },
      { name: OneTimeToken.name, schema: OneTimeTokenSchema },
    ]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<ApiEnv, true>) => ({
        secret: config.get("JWT_ACCESS_SECRET", { infer: true }),
        signOptions: { algorithm: "HS256", expiresIn: ACCESS_TOKEN_TTL_SECONDS },
        // Pin the algorithm on verification too, so a token signed with another algorithm is rejected.
        verifyOptions: { algorithms: ["HS256"] },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AccessTokenService,
    AccessTokenGuard,
    PasswordHasher,
    SessionCookies,
    SessionsRepository,
    OneTimeTokensRepository,
  ],
  exports: [AccessTokenGuard, AccessTokenService],
})
export class AuthModule {}
