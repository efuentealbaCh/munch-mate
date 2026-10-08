import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { type ClientSession, type Model, Types } from "mongoose";
import { type PlatformRole, User } from "./schemas/user.schema";

/** Plain user object returned by the repository; services never handle Mongoose documents. */
export interface UserRecord {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  emailVerifiedAt: Date | null;
  platformRole: PlatformRole | null;
}

/** Thrown when the unique index on `email` rejects an insert. */
export class EmailTakenError extends Error {
  constructor() {
    super("email already registered");
  }
}

const DUPLICATE_KEY = 11000;

@Injectable()
export class UsersRepository {
  constructor(@InjectModel(User.name) private readonly users: Model<User>) {}

  /**
   * @throws EmailTakenError when the (normalized) email already exists. Relies on the unique index,
   *   not on a prior lookup, so two concurrent registrations cannot both succeed.
   */
  async create(input: { email: string; name: string; passwordHash: string }): Promise<UserRecord> {
    try {
      const doc = await this.users.create(input);
      return toRecord(doc.toObject());
    } catch (error) {
      if ((error as { code?: number }).code === DUPLICATE_KEY) throw new EmailTakenError();
      throw error;
    }
  }

  async findById(id: string): Promise<UserRecord | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const doc = await this.users.findById(id).lean();
    return doc ? toRecord(doc) : null;
  }

  async findByIds(ids: string[]): Promise<UserRecord[]> {
    const docs = await this.users.find({ _id: { $in: ids.filter((id) => Types.ObjectId.isValid(id)) } }).lean();
    return docs.map(toRecord);
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    const doc = await this.users.findOne({ email: email.trim().toLowerCase() }).lean();
    return doc ? toRecord(doc) : null;
  }

  /** Sets emailVerifiedAt only if not already verified, keeping the original verification date. */
  async markEmailVerified(id: string, session?: ClientSession): Promise<void> {
    await this.users.updateOne(
      { _id: id, emailVerifiedAt: null },
      { $set: { emailVerifiedAt: new Date() } },
      { session },
    );
  }

  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    await this.users.updateOne({ _id: id }, { $set: { passwordHash } });
  }
}

function toRecord(doc: User & { _id: Types.ObjectId }): UserRecord {
  return {
    id: doc._id.toString(),
    email: doc.email,
    name: doc.name,
    passwordHash: doc.passwordHash,
    emailVerifiedAt: doc.emailVerifiedAt ?? null,
    platformRole: doc.platformRole ?? null,
  };
}
