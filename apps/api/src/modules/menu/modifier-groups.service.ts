import type { ModifierGroupView } from "@app/types";
import { BadRequestException, Injectable } from "@nestjs/common";
import { apiError } from "../../common/errors/api-error";
import { modifierGroupNotFound, modifierOptionNotFound } from "./menu.errors";
import { type ModifierGroupInput, type ModifierGroupRecord, ModifierGroupsRepository } from "./modifier-groups.repository";
import { ProductsRepository } from "./products.repository";

@Injectable()
export class ModifierGroupsService {
  constructor(
    private readonly groups: ModifierGroupsRepository,
    private readonly products: ProductsRepository,
  ) {}

  async list(restaurantId: string): Promise<ModifierGroupView[]> {
    const [groups, usage] = await Promise.all([
      this.groups.list(restaurantId),
      this.products.countByModifierGroup(restaurantId),
    ]);
    return groups.map((group) => toView(group, usage.get(group.id) ?? 0));
  }

  /** @throws BadRequestException INVALID_MODIFIER_RULES. */
  async create(restaurantId: string, input: ModifierGroupInput): Promise<ModifierGroupView> {
    assertRules(input);
    return toView(await this.groups.create(restaurantId, input), 0);
  }

  /**
   * Replaces name, rules and options. Options sent with their `id` keep it.
   * @throws NotFoundException MODIFIER_GROUP_NOT_FOUND; BadRequestException INVALID_MODIFIER_RULES.
   */
  async replace(restaurantId: string, groupId: string, input: ModifierGroupInput): Promise<ModifierGroupView> {
    assertRules(input);
    const updated = await this.groups.replace(restaurantId, groupId, input);
    if (!updated) throw modifierGroupNotFound();
    const usage = await this.products.countByModifierGroup(restaurantId);
    return toView(updated, usage.get(groupId) ?? 0);
  }

  /** Deletes the group and detaches it from every product that used it. */
  async delete(restaurantId: string, groupId: string): Promise<void> {
    if (!(await this.groups.findOne(restaurantId, groupId))) throw modifierGroupNotFound();
    await this.products.removeModifierGroup(restaurantId, groupId);
    await this.groups.delete(restaurantId, groupId);
  }

  /** "Agotado" toggle for one option (e.g. no avocado today), allowed to kitchen and cashier staff. */
  async setOptionAvailability(
    restaurantId: string,
    groupId: string,
    optionId: string,
    available: boolean,
  ): Promise<void> {
    if (!(await this.groups.setOptionAvailability(restaurantId, groupId, optionId, available))) {
      throw modifierOptionNotFound();
    }
  }
}

/**
 * Selection rules must be satisfiable: a required group needs enough options to pick from, and a group
 * cannot ask for more choices than it offers.
 */
function assertRules(input: ModifierGroupInput): void {
  const optionCount = input.options.length;
  const problem =
    input.maxSelect < input.minSelect
      ? "El máximo de opciones no puede ser menor que el mínimo"
      : input.maxSelect > optionCount
        ? `El máximo (${input.maxSelect}) no puede superar la cantidad de opciones (${optionCount})`
        : null;
  if (problem) throw new BadRequestException(apiError("INVALID_MODIFIER_RULES", problem));
}

function toView(group: ModifierGroupRecord, usedByProducts: number): ModifierGroupView {
  return { ...group, usedByProducts };
}
