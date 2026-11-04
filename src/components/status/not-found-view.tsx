import { Mark } from "@/components/brand/logo";

/**
 * The 404 page body, shared by the site, the reader and URLs that match no
 * route. The action is a plain link: from the reader it must be a full page
 * load anyway (separate root layout).
 */
export function NotFoundView({
  title,
  body,
  english,
  action,
  as: Tag = "div",
}: {
  title: string;
  body: string;
  /** a secondary English line on Bengali pages */
  english?: string;
  action: { href: string; label: string };
  as?: "main" | "div";
}) {
  return (
    <Tag className="flex min-h-[70dvh] items-center justify-center px-6 py-16 text-center">
      <div className="max-w-md">
        <Mark className="mx-auto size-16 text-mark" />
        <h1 className="mt-6 font-display text-3xl leading-snug">{title}</h1>
        <p className="mt-3 text-fg-muted">{body}</p>
        {english ? (
          <p lang="en" className="mt-1 text-sm text-fg-subtle">
            {english}
          </p>
        ) : null}
        <a
          href={action.href}
          className="mt-8 inline-flex h-11 items-center rounded-control bg-cloth px-5 text-on-cloth transition-colors duration-200 hover:bg-cloth-raised"
        >
          {action.label}
        </a>
      </div>
    </Tag>
  );
}
