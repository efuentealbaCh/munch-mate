import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { AuthUser } from "./auth.types";

/** JWT claims. Kept minimal: the token travels in a cookie on every request. */
interface AccessClaims {
  sub: string;
  sid: string;
  ev: boolean;
}

@Injectable()
export class AccessTokenService {
  constructor(private readonly jwt: JwtService) {}

  sign(user: AuthUser): Promise<string> {
    const claims: AccessClaims = { sub: user.id, sid: user.sessionId, ev: user.emailVerified };
    return this.jwt.signAsync(claims);
  }

  /** @returns The identity, or null for an expired, tampered or malformed token. */
  async verify(token: string): Promise<AuthUser | null> {
    try {
      const claims = await this.jwt.verifyAsync<AccessClaims>(token);
      return { id: claims.sub, sessionId: claims.sid, emailVerified: claims.ev };
    } catch {
      return null;
    }
  }
}
