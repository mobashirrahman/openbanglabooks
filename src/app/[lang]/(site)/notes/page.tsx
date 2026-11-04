import type { Metadata } from "next";
import { NotesView } from "@/components/notes/notes-view";
import { getDictionary, getLocale } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const dict = await getDictionary();
  return { title: dict.notes.title, robots: { index: false, follow: false } };
}

/** Highlights and notes from every book. Local to this device until accounts arrive (Phase 2). */
export default async function NotesPage() {
  const locale = await getLocale();
  const dict = await getDictionary(locale);
  const r = dict.reader;
  return (
    <div className="mx-auto max-w-4xl px-4 pt-10 sm:px-6 sm:pt-14 lg:px-8">
      <h1 className="text-4xl sm:text-5xl">{dict.notes.title}</h1>
      <p className="mt-2 mb-8 text-fg-muted">{dict.notes.description}</p>
      <NotesView
        locale={locale}
        labels={{
          ...dict.notes,
          findBook: locale === "bn" ? "বই খুঁজুন" : "Find a book",
          reader: {
            colors: r.colors,
            note: r.note,
            notePlaceholder: r.notePlaceholder,
            save: r.save,
            cancel: r.cancel,
            deleteNote: r.deleteNote,
            closeMenu: r.closeMenu,
            addNote: r.addNote,
            editNote: r.editNote,
            deleteHighlight: r.deleteHighlight,
            chapterOf: r.chapterOf,
          },
        }}
      />
    </div>
  );
}
