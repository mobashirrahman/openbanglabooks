import { cn } from "@/lib/utils";

export function StatusBadge({ status, label }: { status: string; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs",
        status === "published" ? "bg-cloth/10 text-cloth dark:bg-foil/15 dark:text-foil" : status === "withdrawn" ? "bg-destructive/10 text-destructive" : "bg-sunken text-fg-muted",
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", status === "published" ? "bg-cloth dark:bg-foil" : status === "withdrawn" ? "bg-destructive" : "bg-fg-subtle")} />
      {label}
    </span>
  );
}
