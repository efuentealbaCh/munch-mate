"use client";

import { OPENING_HOURS_LIMITS, type TimeRange, WEEKDAY_LABELS, type WeeklyHours } from "@app/types";
import { localClock } from "@app/utils";
import { CopyIcon, MoonIcon } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { toast } from "sonner";
import { FormError } from "@/components/form-error";
import { NativeSelect } from "@/components/native-select";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { WeeklyHoursList } from "@/components/weekly-hours-list";
import { useNow } from "@/hooks/use-now";
import { restaurantsApi } from "@/lib/endpoints";
import { errorMessage, hasCode } from "@/lib/errors";
import {
  copyToAllDays,
  copyToWeekdays,
  crossesMidnight,
  dayProblems,
  defaultWeek,
  isAlwaysClosed,
  liveOpenState,
  nextOpeningLabel,
  sameHours,
  setRangeCount,
  updateRange,
} from "@/lib/opening-hours";
import { cn } from "@/lib/utils";
import { useRestaurant } from "./restaurant-context";

const RANGE_COUNT_LABELS = ["Cerrado", "1 tramo", "2 tramos"] as const;

/**
 * "Horario de atención" card. Owners edit the weekly schedule (null = no schedule: only the manual switch on
 * the Pedidos screen decides); other members see it read-only. Saved with an explicit button because a
 * schedule is several fields; the api validates it again (INVALID_OPENING_HOURS).
 */
export function OpeningHoursSettings() {
  const { restaurant, isOwner } = useRestaurant();
  if (!isOwner) return <OpeningHoursReadOnly />;
  // Remount after each save so the editor starts from the stored schedule.
  return <OpeningHoursEditor key={JSON.stringify(restaurant.openingHours)} />;
}

/** Status line under the schedule: whether customers can order right now because of it. */
function ScheduleStatus() {
  const { restaurant } = useRestaurant();
  const now = useNow(30_000);
  if (!restaurant.openingHours) return null;
  const state = liveOpenState(restaurant.openingHours, restaurant.timezone, now, restaurant.openState);
  if (state.openNow) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="schedule-status">
        Ahora estás dentro del horario de atención.
      </p>
    );
  }
  const label = nextOpeningLabel(state.nextOpeningAt, now ? new Date(now) : new Date());
  return (
    <p className="rounded-lg bg-warning px-3 py-2 text-sm text-warning-foreground" role="status" data-testid="schedule-status">
      Ahora estás <strong>fuera de horario</strong>: los clientes ven el menú pero no pueden pedir.
      {label ? ` ${label}.` : null}
    </p>
  );
}

function OpeningHoursReadOnly() {
  const { restaurant } = useRestaurant();
  if (!restaurant.openingHours) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="opening-hours-off">
        Sin horario: los clientes pueden pedir mientras el local esté abierto en <strong>Pedidos</strong>. Lo cambia el
        dueño.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <WeeklyHoursList hours={restaurant.openingHours} today={localClock(new Date(), restaurant.timezone).weekday} />
      <ScheduleStatus />
      <p className="text-xs text-muted-foreground">Horas en {restaurant.timezone}. Lo cambia el dueño.</p>
    </div>
  );
}

function OpeningHoursEditor() {
  const { restaurant, setRestaurant, reload } = useRestaurant();
  const stored = restaurant.openingHours;
  const [enabled, setEnabled] = useState(stored !== null);
  const [draft, setDraft] = useState<WeeklyHours>(() => stored ?? defaultWeek());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const switchId = useId();
  const descriptionId = useId();
  const suspended = restaurant.status === "suspended";

  const next = enabled ? draft : null;
  const dirty = !sameHours(next, stored);
  const problems = enabled ? dayProblems(draft) : {};
  const hasProblems = Object.keys(problems).length > 0;

  function edit(update: (hours: WeeklyHours) => WeeklyHours) {
    setDraft((current) => update(current));
    setError(null);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (hasProblems) {
      // Messages are already shown next to each day; take the owner to the first one.
      const first = Object.keys(problems)[0];
      document.getElementById(`opening-day-${first}`)?.focus();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      setRestaurant(await restaurantsApi.setOpeningHours(restaurant.id, next));
      toast.success(next ? "Guardaste el horario de atención" : "Quitaste el horario de atención");
    } catch (failure) {
      setError(failure);
      if (hasCode(failure, "FORBIDDEN_ROLE")) {
        toast.error(errorMessage(failure));
        reload();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => void save(event)} noValidate>
      <label htmlFor={switchId} className="flex cursor-pointer items-start gap-4">
        <Switch
          id={switchId}
          size="lg"
          className="mt-0.5"
          checked={enabled}
          disabled={saving || suspended}
          aria-describedby={descriptionId}
          onCheckedChange={(checked) => {
            setEnabled(checked);
            setError(null);
          }}
        />
        <span className="flex flex-col gap-0.5">
          <span className="font-semibold">Usar horario</span>
          <span id={descriptionId} className="text-sm text-muted-foreground">
            {enabled
              ? "Fuera de estos horarios los clientes ven el menú pero no pueden pedir, aunque el local esté abierto en Pedidos."
              : "Sin horario: los clientes pueden pedir siempre que el local esté abierto en Pedidos."}
          </span>
        </span>
      </label>

      {enabled ? (
        <>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => edit((h) => copyToWeekdays(h, 0))}>
              <CopyIcon aria-hidden data-icon="inline-start" />
              Igual de lunes a viernes
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => edit((h) => copyToAllDays(h, 0))}>
              <CopyIcon aria-hidden data-icon="inline-start" />
              Copiar el lunes a todos los días
            </Button>
          </div>
          <ol className="flex flex-col divide-y rounded-xl ring-1 ring-foreground/10">
            {draft.map((ranges, day) => (
              <DayEditor
                key={WEEKDAY_LABELS[day]}
                day={day}
                ranges={ranges}
                disabled={saving || suspended}
                problem={problems[day] ?? null}
                onCount={(count) => edit((h) => setRangeCount(h, day, count))}
                onTime={(index, field, value) => edit((h) => updateRange(h, day, index, field, value))}
              />
            ))}
          </ol>
          <p className="text-xs text-muted-foreground">
            Horas en {restaurant.timezone}. Si el cierre es antes que la apertura (19:00 a 01:00), el tramo termina al día
            siguiente.
          </p>
          {isAlwaysClosed(draft) ? (
            <p className="rounded-lg bg-warning px-3 py-2 text-sm text-warning-foreground" role="status">
              Todos los días están cerrados: con este horario nadie podrá pedir.
            </p>
          ) : null}
        </>
      ) : null}

      {dirty ? null : <ScheduleStatus />}
      <FormError error={error} />
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pending={saving} disabled={!dirty || suspended} className="self-start">
          Guardar horario
        </SubmitButton>
        {dirty ? (
          <span className="text-sm text-muted-foreground" role="status">
            Tienes cambios sin guardar.
          </span>
        ) : null}
      </div>
    </form>
  );
}

function DayEditor({
  day,
  ranges,
  disabled,
  problem,
  onCount,
  onTime,
}: {
  day: number;
  ranges: TimeRange[];
  disabled: boolean;
  problem: string | null;
  onCount(count: number): void;
  onTime(index: number, field: keyof TimeRange, value: string): void;
}) {
  const label = WEEKDAY_LABELS[day];
  const selectId = `opening-day-${day}`;
  const problemId = useId();

  return (
    <li className="flex flex-col gap-2 px-3 py-3" data-testid={`opening-day-${day}`}>
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={selectId} className="font-medium">
          {label}
        </label>
        <NativeSelect
          id={selectId}
          className="w-32"
          value={ranges.length}
          disabled={disabled}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? problemId : undefined}
          onChange={(event) => onCount(Number(event.target.value))}
        >
          {RANGE_COUNT_LABELS.slice(0, OPENING_HOURS_LIMITS.rangesPerDay + 1).map((text, count) => (
            <option key={text} value={count}>
              {text}
            </option>
          ))}
        </NativeSelect>
      </div>
      {ranges.map((range, index) => (
        <div key={index} className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Input
              type="time"
              step={60}
              required
              value={range.open}
              disabled={disabled}
              aria-label={`${label}, tramo ${index + 1}: abre`}
              aria-invalid={problem ? true : undefined}
              className="w-auto flex-1"
              onChange={(event) => onTime(index, "open", event.target.value)}
            />
            <span className="text-sm text-muted-foreground" aria-hidden>
              a
            </span>
            <Input
              type="time"
              step={60}
              required
              value={range.close}
              disabled={disabled}
              aria-label={`${label}, tramo ${index + 1}: cierra`}
              aria-invalid={problem ? true : undefined}
              className="w-auto flex-1"
              onChange={(event) => onTime(index, "close", event.target.value)}
            />
          </div>
          {crossesMidnight(range) ? (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <MoonIcon className="size-3.5" aria-hidden />
              Termina al día siguiente
            </p>
          ) : null}
        </div>
      ))}
      <p id={problemId} className={cn("text-sm text-destructive", !problem && "sr-only")} aria-live="polite">
        {problem}
      </p>
    </li>
  );
}
