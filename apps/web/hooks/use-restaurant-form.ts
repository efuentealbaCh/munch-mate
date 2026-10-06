"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRef } from "react";
import { useForm } from "react-hook-form";
import { useSlugAvailability } from "@/hooks/use-slug-availability";
import { normalizeSlugInput, slugAfterNameChange } from "@/lib/slug-field";
import { type RestaurantValues, restaurantSchema } from "@/lib/validation";

/**
 * Name + slug form shared by "create" and "settings".
 * @param initial Current values when editing (the slug then never follows the name automatically).
 */
export function useRestaurantForm(initial?: RestaurantValues) {
  const form = useForm<RestaurantValues>({
    resolver: zodResolver(restaurantSchema),
    defaultValues: initial ?? { name: "", slug: "" },
  });
  const autoSlug = initial === undefined;
  // True once the owner edits the slug by hand; from then on the name no longer overwrites it.
  const slugTouched = useRef(!autoSlug);
  const slug = form.watch("slug");
  const { status: slugStatus, markTaken } = useSlugAvailability(slug, initial?.slug);

  const setSlug = (value: string) =>
    form.setValue("slug", value, { shouldDirty: true, shouldValidate: form.formState.isSubmitted });

  const nameField = form.register("name", {
    onChange: (event: { target: { value: string } }) => {
      if (autoSlug) setSlug(slugAfterNameChange(event.target.value, slugTouched.current, form.getValues("slug")));
    },
  });

  const slugField = form.register("slug", {
    onChange: (event: { target: { value: string } }) => {
      const value = normalizeSlugInput(event.target.value);
      // Clearing the field hands control back to the name (only when creating).
      slugTouched.current = !autoSlug || value !== "";
      if (value !== event.target.value) setSlug(value);
    },
  });

  function applySuggestion(suggestion: string) {
    slugTouched.current = true;
    setSlug(suggestion);
    form.setFocus("slug");
  }

  return { form, slug, slugStatus, markTaken, nameField, slugField, applySuggestion };
}
