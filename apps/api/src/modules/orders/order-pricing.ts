import type { OrderItemInput } from "@app/types";

/** Menu data needed to price an order, loaded once per request. */
export interface PricingMenu {
  products: Map<
    string,
    { id: string; name: string; price: number; available: boolean; orderable: boolean; modifierGroupIds: string[] }
  >;
  groups: Map<
    string,
    {
      id: string;
      name: string;
      minSelect: number;
      maxSelect: number;
      options: { id: string; name: string; priceDelta: number; available: boolean }[];
    }
  >;
}

export interface PricedModifier {
  groupId: string;
  groupName: string;
  optionId: string;
  optionName: string;
  priceDelta: number;
}

export interface PricedItem {
  productId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  modifiers: PricedModifier[];
  note: string;
  lineTotal: number;
}

/** The cart does not match the current menu. `code` is returned to the client as the api error code. */
export class OrderValidationError extends Error {
  constructor(
    readonly code: "PRODUCT_NOT_AVAILABLE" | "PRODUCT_SOLD_OUT" | "OPTION_SOLD_OUT" | "INVALID_MODIFIERS",
    message: string,
    readonly productId: string,
  ) {
    super(message);
  }
}

/**
 * Prices a cart against the current menu. The client only sends ids and quantities: names and prices come
 * from the menu, so a tampered request cannot change what the restaurant charges.
 * Modifiers are stored in the product's group order and each group's option order, whatever order the
 * client sent them in.
 * @throws OrderValidationError when a product, option or selection rule no longer holds.
 */
export function priceOrder(items: OrderItemInput[], menu: PricingMenu): { items: PricedItem[]; subtotal: number } {
  const priced = items.map((item) => priceItem(item, menu));
  return { items: priced, subtotal: priced.reduce((sum, item) => sum + item.lineTotal, 0) };
}

function priceItem(item: OrderItemInput, menu: PricingMenu): PricedItem {
  const product = menu.products.get(item.productId);
  if (!product?.orderable) {
    throw new OrderValidationError(
      "PRODUCT_NOT_AVAILABLE",
      `${product ? `«${product.name}»` : "Un producto"} ya no está en el menú`,
      item.productId,
    );
  }
  if (!product.available) {
    throw new OrderValidationError("PRODUCT_SOLD_OUT", `«${product.name}» está agotado`, item.productId);
  }

  const invalid = (detail: string) =>
    new OrderValidationError("INVALID_MODIFIERS", `«${product.name}»: ${detail}`, item.productId);

  const chosenByGroup = new Map<string, string[]>();
  for (const selection of item.modifiers) {
    if (!product.modifierGroupIds.includes(selection.groupId) || chosenByGroup.has(selection.groupId)) {
      throw invalid("las opciones elegidas no corresponden al producto");
    }
    if (new Set(selection.optionIds).size !== selection.optionIds.length) {
      throw invalid("hay opciones repetidas");
    }
    chosenByGroup.set(selection.groupId, selection.optionIds);
  }

  const modifiers: PricedModifier[] = [];
  for (const groupId of product.modifierGroupIds) {
    const group = menu.groups.get(groupId);
    if (!group) continue; // deleted group still referenced: nothing to choose
    const chosen = chosenByGroup.get(groupId) ?? [];

    if (chosen.length < group.minSelect) {
      throw invalid(
        group.minSelect === 1 ? `elige una opción en «${group.name}»` : `elige al menos ${group.minSelect} en «${group.name}»`,
      );
    }
    if (chosen.length > group.maxSelect) {
      throw invalid(`en «${group.name}» puedes elegir hasta ${group.maxSelect}`);
    }

    for (const option of group.options) {
      if (!chosen.includes(option.id)) continue;
      if (!option.available) {
        throw new OrderValidationError("OPTION_SOLD_OUT", `«${option.name}» está agotado`, item.productId);
      }
      modifiers.push({
        groupId: group.id,
        groupName: group.name,
        optionId: option.id,
        optionName: option.name,
        priceDelta: option.priceDelta,
      });
    }
    if (modifiers.filter((m) => m.groupId === group.id).length !== chosen.length) {
      throw invalid(`alguna opción de «${group.name}» ya no existe`);
    }
  }

  const unitTotal = product.price + modifiers.reduce((sum, m) => sum + m.priceDelta, 0);
  return {
    productId: product.id,
    name: product.name,
    unitPrice: product.price,
    quantity: item.quantity,
    modifiers,
    note: item.note?.trim() ?? "",
    lineTotal: unitTotal * item.quantity,
  };
}
