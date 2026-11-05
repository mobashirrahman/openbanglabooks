import "server-only";
import { redirect } from "next/navigation";
import { localizedPath, type Locale } from "@/lib/i18n/config";
import { adminGate, type EditorSession } from "./auth";

/**
 * For admin pages: the editor's session, or null when the layout is showing
 * the "editors only" notice instead (pages render alongside their layout,
 * so each page checks again and shows nothing to anyone else).
 */
export async function pageEditor(locale: Locale): Promise<EditorSession | null> {
  const gate = await adminGate();
  if (gate.kind === "signed-out") redirect(signInPath(locale));
  return gate.kind === "editor" ? gate : null;
}

export const signInPath = (locale: Locale) => `${localizedPath(locale, "/signin")}?next=${encodeURIComponent(localizedPath(locale, "/admin"))}`;

/** One author line for lists: the work's authors in credit order. */
export function creditLine(rows: { position: number; role: string; authors: { name_bn: string; name_en: string } | null }[] | null, locale: Locale) {
  return (rows ?? [])
    .filter((r) => r.role === "author" && r.authors)
    .sort((a, b) => a.position - b.position)
    .map((r) => (locale === "bn" ? r.authors!.name_bn : r.authors!.name_en))
    .join(", ");
}

/** Choices for the work form: every author, genre and collection. */
export async function workOptions(editor: EditorSession) {
  const [authors, genres, collections] = await Promise.all([
    editor.supabase.from("authors").select("id, name_bn, name_en, died_year").order("name_bn"),
    editor.supabase.from("genres").select("id, name_bn, name_en").order("position"),
    editor.supabase.from("collections").select("id, name_bn, name_en").order("position"),
  ]);
  return { authors: authors.data ?? [], genres: genres.data ?? [], collections: collections.data ?? [] };
}
