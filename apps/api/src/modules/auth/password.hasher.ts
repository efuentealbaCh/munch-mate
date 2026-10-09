import { Injectable, type OnModuleInit } from "@nestjs/common";
import argon2 from "argon2";
import { generateToken } from "../../common/crypto/tokens";

/** argon2id password hashing with the library defaults (64 MiB, 3 iterations, parallelism 4). */
@Injectable()
export class PasswordHasher implements OnModuleInit {
  /** Hash of a random value, verified against when the user does not exist (see verifyOrDummy). */
  private dummyHash = "";

  async onModuleInit(): Promise<void> {
    this.dummyHash = await this.hash(generateToken());
  }

  hash(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id });
  }

  /** @returns false for a wrong password or a malformed hash; never throws. */
  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  /**
   * Burns the same time as a real verification when there is no user, so login response times
   * do not reveal which emails are registered. Always resolves to false.
   */
  async verifyDummy(password: string): Promise<false> {
    await this.verify(this.dummyHash, password);
    return false;
  }
}
