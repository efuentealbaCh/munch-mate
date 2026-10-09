import {
  CUSTOMER_LIMITS,
  type ProfileInput,
  type SavedAddressInput,
  type SavedAddressView,
  type UserProfile,
} from "@app/types";
import { isNameTaken, normalizePhone, roundCoord } from "@app/utils";
import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { apiError } from "../../common/errors/api-error";
import { UsersRepository } from "../users/users.repository";
import {
  type CustomerAddressFields,
  type CustomerAddressRecord,
  CustomerAddressesRepository,
} from "./customer-addresses.repository";

const addressNotFound = () => new NotFoundException(apiError("ADDRESS_NOT_FOUND", "Esa dirección no existe"));

/** What a signed-in person keeps for ordering: name, phone and saved delivery addresses. */
@Injectable()
export class CustomersService {
  constructor(
    private readonly users: UsersRepository,
    private readonly addresses: CustomerAddressesRepository,
  ) {}

  /**
   * Name and/or phone; the phone is stored normalized ("" clears it).
   * @throws BadRequestException INVALID_PHONE.
   */
  async updateProfile(userId: string, input: ProfileInput): Promise<UserProfile> {
    const changes: { name?: string; phone?: string } = {};
    if (input.name !== undefined) changes.name = input.name;
    if (input.phone !== undefined) {
      const phone = input.phone.trim() === "" ? "" : normalizePhone(input.phone);
      if (phone === null) {
        throw new BadRequestException(apiError("INVALID_PHONE", "Revisa el teléfono, ej. +569 12345678"));
      }
      changes.phone = phone;
    }
    const user = await this.users.updateProfile(userId, changes);
    if (!user) throw new NotFoundException(apiError("USER_NOT_FOUND", "No encontramos tu cuenta"));
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerified: user.emailVerifiedAt !== null,
      platformRole: user.platformRole,
      phone: user.phone,
    };
  }

  async listAddresses(userId: string): Promise<SavedAddressView[]> {
    return (await this.addresses.list(userId)).map(toView);
  }

  /** @throws ConflictException ADDRESSES_LIMIT, ADDRESS_LABEL_TAKEN. */
  async createAddress(userId: string, input: SavedAddressInput): Promise<SavedAddressView> {
    const existing = await this.addresses.list(userId);
    if (existing.length >= CUSTOMER_LIMITS.addressesMax) {
      throw new ConflictException(
        apiError("ADDRESSES_LIMIT", `Puedes guardar hasta ${CUSTOMER_LIMITS.addressesMax} direcciones`),
      );
    }
    this.assertLabelFree(input.label, existing);
    return toView(await this.addresses.create(userId, fields(input)));
  }

  /** @throws NotFoundException ADDRESS_NOT_FOUND; ConflictException ADDRESS_LABEL_TAKEN. */
  async updateAddress(userId: string, addressId: string, input: SavedAddressInput): Promise<SavedAddressView> {
    this.assertLabelFree(input.label, await this.addresses.list(userId), addressId);
    const updated = await this.addresses.update(userId, addressId, fields(input));
    if (!updated) throw addressNotFound();
    return toView(updated);
  }

  /** @throws NotFoundException ADDRESS_NOT_FOUND. */
  async deleteAddress(userId: string, addressId: string): Promise<void> {
    if (!(await this.addresses.delete(userId, addressId))) throw addressNotFound();
  }

  /** "Casa" twice would make the checkout picker ambiguous. */
  private assertLabelFree(label: string, existing: CustomerAddressRecord[], exceptId?: string): void {
    if (isNameTaken(label, existing.map((a) => ({ id: a.id, name: a.label })), exceptId)) {
      throw new ConflictException(apiError("ADDRESS_LABEL_TAKEN", `Ya tienes una dirección llamada «${label}»`));
    }
  }
}

function fields(input: SavedAddressInput): CustomerAddressFields {
  return {
    label: input.label,
    address: input.address,
    unit: input.unit ?? "",
    reference: input.reference ?? "",
    location: input.location ? { lat: roundCoord(input.location.lat), lng: roundCoord(input.location.lng) } : null,
  };
}

function toView(record: CustomerAddressRecord): SavedAddressView {
  return {
    id: record.id,
    label: record.label,
    address: record.address,
    unit: record.unit,
    reference: record.reference,
    location: record.location,
    createdAt: record.createdAt.toISOString(),
  };
}
