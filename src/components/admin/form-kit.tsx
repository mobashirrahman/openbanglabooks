"use client";

import { startTransition, useActionState, useEffect, useId, useRef, type ReactNode } from "react";
import { Check, Loader2 } from "lucide-react";
import type { FormState } from "@/lib/admin/actions";
import type { Dictionary } from "@/lib/i18n/dictionaries/bn";
import { cn } from "@/lib/utils";

export type AdminLabels = Dictionary["admin"];
type Action = (state: FormState, fd: FormData) => Promise<FormState>;

const IDLE: FormState = { status: "idle" };

/**
 * An admin form bound to a server action. Submits from onSubmit (not the
 * form action) so that a rejected save keeps what the editor typed — React
 * resets uncontrolled forms after an action — while `action` stays set for
 * submissions before hydration.
 */
export function useAdminForm(action: Action, { confirm }: { confirm?: string } = {}) {
  const [state, dispatch, pending] = useActionState(action, IDLE);
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (confirm && !window.confirm(confirm)) return;
    const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
    startTransition(() => dispatch(fd));
  };
  return { state, pending, form: { action: dispatch, onSubmit, noValidate: true } };
}

/** The result line of a form: saved, or what went wrong. */
export function FormStatus({ state, labels }: { state: FormState; labels: AdminLabels }) {
  const ref = useRef<HTMLParagraphElement>(null);
  // move focus to a new error summary so keyboard and screen reader users hear it
  useEffect(() => {
    if (state.at && state.status === "error") ref.current?.focus();
  }, [state.at, state.status]);
  if (state.status === "idle") return <p role="status" className="sr-only" />;
  const text =
    state.status === "saved"
      ? labels.messages.saved
      : state.message && state.message !== "saved"
        ? labels.messages[state.message]
        : labels.errorSummary;
  return (
    <p
      ref={ref}
      tabIndex={-1}
      role={state.status === "error" ? "alert" : "status"}
      className={cn(
        "inline-flex items-center gap-2 rounded-control px-3 py-2 text-sm outline-none",
        state.status === "saved" ? "bg-sunken text-fg" : "bg-destructive/10 text-destructive",
      )}
    >
      {state.status === "saved" ? <Check aria-hidden className="size-4" /> : null}
      {text}
    </p>
  );
}

export function SubmitButton({ pending, children, pendingText, className }: { pending: boolean; children: ReactNode; pendingText: string; className?: string }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(
        "inline-flex h-11 items-center justify-center gap-2 rounded-control bg-cloth px-5 text-on-cloth transition-colors hover:bg-cloth-raised disabled:opacity-70",
        className,
      )}
    >
      {pending ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
      {pending ? pendingText : children}
    </button>
  );
}

const control =
  "w-full rounded-[10px] border border-line-strong bg-surface px-3.5 text-base outline-none focus-visible:border-focus focus-visible:ring-2 focus-visible:ring-focus/30 aria-invalid:border-destructive";

type FieldProps = {
  name: string;
  label: string;
  hint?: string;
  state: FormState;
  labels: AdminLabels;
  className?: string;
};

function useField(name: string, state: FormState, labels: AdminLabels) {
  const id = useId();
  const code = state.status === "error" ? state.errors?.[name] : undefined;
  return { id: `${id}-${name}`, error: code ? labels.errors[code] : undefined };
}

function Shell({ id, label, hint, error, className, children }: { id: string; label: string; hint?: string; error?: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-fg-subtle">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const describedBy = (id: string, hint?: string, error?: string) => [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;

export function TextField({
  name,
  label,
  hint,
  state,
  labels,
  className,
  defaultValue,
  required,
  inputMode,
  lang,
  placeholder,
}: FieldProps & { defaultValue?: string | number | null; required?: boolean; inputMode?: "numeric" | "url" | "text"; lang?: string; placeholder?: string }) {
  const { id, error } = useField(name, state, labels);
  return (
    <Shell id={id} label={label} hint={hint} error={error} className={className}>
      <input
        id={id}
        name={name}
        defaultValue={defaultValue ?? ""}
        required={required}
        inputMode={inputMode}
        lang={lang}
        placeholder={placeholder}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={cn(control, "h-11")}
      />
    </Shell>
  );
}

export function TextArea({ name, label, hint, state, labels, className, defaultValue, rows = 4, lang }: FieldProps & { defaultValue?: string | null; rows?: number; lang?: string }) {
  const { id, error } = useField(name, state, labels);
  return (
    <Shell id={id} label={label} hint={hint} error={error} className={className}>
      <textarea
        id={id}
        name={name}
        rows={rows}
        lang={lang}
        defaultValue={defaultValue ?? ""}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={cn(control, "resize-y py-2.5 leading-relaxed")}
      />
    </Shell>
  );
}

export function SelectField({
  name,
  label,
  hint,
  state,
  labels,
  className,
  defaultValue,
  options,
}: FieldProps & { defaultValue?: string; options: { value: string; label: string }[] }) {
  const { id, error } = useField(name, state, labels);
  return (
    <Shell id={id} label={label} hint={hint} error={error} className={className}>
      <select
        id={id}
        name={name}
        defaultValue={defaultValue}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={cn(control, "h-11 pr-8")}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Shell>
  );
}

export function CheckboxField({ name, label, defaultChecked, value = "on", hint }: { name: string; label: string; defaultChecked?: boolean; value?: string; hint?: string }) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        className="mt-1 size-5 shrink-0 accent-[var(--color-cloth)]"
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
      <div>
        <label htmlFor={id} className="text-[0.95rem]">
          {label}
        </label>
        {hint ? (
          <p id={`${id}-hint`} className="text-xs text-fg-subtle">
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** A group of fields with a heading. */
export function Fieldset({ legend, children, className }: { legend: string; children: ReactNode; className?: string }) {
  return (
    <fieldset className={cn("space-y-5 rounded-[14px] border border-line bg-surface p-5 sm:p-6", className)}>
      <legend className="-ml-1 px-1 font-display text-xl">{legend}</legend>
      {children}
    </fieldset>
  );
}

/** A small form that deletes something, after a confirmation. */
export function DeleteForm({
  action,
  fields,
  label,
  confirm,
  labels,
}: {
  action: Action;
  fields: Record<string, string>;
  label: string;
  confirm: string;
  labels: AdminLabels;
}) {
  const { state, pending, form } = useAdminForm(action, { confirm });
  return (
    <form {...form} className="flex flex-wrap items-center gap-3">
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-10 items-center gap-2 rounded-control px-3 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-60"
      >
        {pending ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
        {label}
      </button>
      {state.status === "error" ? <FormStatus state={state} labels={labels} /> : null}
    </form>
  );
}
