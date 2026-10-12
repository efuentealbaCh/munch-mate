import type { UsersRepository } from "../users/users.repository";
import type { CustomerAddressesRepository } from "./customer-addresses.repository";
import { CustomersService } from "./customers.service";

const address = (id: string, label: string) => ({
  id,
  userId: "u1",
  label,
  address: "Av. Grecia 1234",
  unit: "",
  reference: "",
  location: null,
  createdAt: new Date("2026-10-09T12:00:00Z"),
});

function setup(existing = [address("a1", "Casa")]) {
  const users = {
    updateProfile: jest.fn(async (_id: string, changes: { name?: string; phone?: string }) => ({
      id: "u1",
      email: "ana@example.com",
      name: changes.name ?? "Ana",
      passwordHash: "x",
      emailVerifiedAt: null,
      platformRole: null,
      phone: changes.phone ?? "",
    })),
  };
  const addresses = {
    list: jest.fn(async () => existing),
    create: jest.fn(async (_u: string, fields: object) => ({ ...address("a2", "x"), ...fields })),
    update: jest.fn(async (_u: string, id: string, fields: object) => (id === "a1" ? { ...address("a1", "x"), ...fields } : null)),
    delete: jest.fn(async (_u: string, id: string) => id === "a1"),
  };
  const service = new CustomersService(
    users as unknown as UsersRepository,
    addresses as unknown as CustomerAddressesRepository,
  );
  return { service, users, addresses };
}

describe("CustomersService", () => {
  it("stores the phone normalized and rejects junk", async () => {
    const { service, users } = setup();

    await expect(service.updateProfile("u1", { phone: "9 1234 5678" })).resolves.toMatchObject({ phone: "+56912345678" });
    expect(users.updateProfile).toHaveBeenCalledWith("u1", { phone: "+56912345678" });
    await expect(service.updateProfile("u1", { phone: "123" })).rejects.toMatchObject({ response: { code: "INVALID_PHONE" } });
    await expect(service.updateProfile("u1", { phone: "" })).resolves.toMatchObject({ phone: "" });
  });

  it("saves addresses with the pin rounded, without repeating a label", async () => {
    const { service, addresses } = setup();

    await service.createAddress("u1", { label: "Trabajo", address: "Providencia 100", location: { lat: -33.4256789123, lng: -70.6 } });
    expect(addresses.create).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ label: "Trabajo", location: { lat: -33.425679, lng: -70.6 } }),
    );
    await expect(service.createAddress("u1", { label: "casa", address: "Otra 1" })).rejects.toMatchObject({
      response: { code: "ADDRESS_LABEL_TAKEN" },
    });
  });

  it("caps the number of saved addresses", async () => {
    const full = Array.from({ length: 10 }, (_, i) => address(`a${i}`, `Dirección ${i}`));

    await expect(setup(full).service.createAddress("u1", { label: "Nueva", address: "Calle 1" })).rejects.toMatchObject({
      response: { code: "ADDRESSES_LIMIT" },
    });
  });

  it("only edits and deletes the caller's own addresses", async () => {
    const { service } = setup();

    await expect(service.updateAddress("u1", "other", { label: "X", address: "Calle 1" })).rejects.toMatchObject({
      response: { code: "ADDRESS_NOT_FOUND" },
    });
    await expect(service.deleteAddress("u1", "other")).rejects.toMatchObject({ response: { code: "ADDRESS_NOT_FOUND" } });
    await expect(service.deleteAddress("u1", "a1")).resolves.toBeUndefined();
  });
});
