"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { localDB, type Annotation, type HighlightColor, type WorkSnapshot } from "@/lib/local/db";
import type { Engine, Relocation } from "@/lib/reader/engine";
import {
  byPosition,
  copyText,
  createAnnotation,
  deleteAnnotation,
  lastHighlightColor,
  quoteOf,
  rememberHighlightColor,
  updateAnnotation,
} from "@/lib/reader/annotations";
import type { MarkStyle } from "@/lib/reader/annotations";
import type { Dictionary } from "@/lib/i18n/dictionaries/bn";
import { Toast, toastId, type ToastMessage } from "@/components/ui/toast";
import { HighlightMenu, type MenuState } from "./highlight-menu";
import { NoteEditor } from "./note-editor";

type Labels = Dictionary["reader"] & { undo: string; deleted: string };

/**
 * Highlights and notes in the reader: which marks to draw, the menu for a
 * selection or a tapped highlight, the note editor, and short confirmations.
 * The reader feeds it events (selection changes, taps on marks) and renders
 * `element`; everything else lives here.
 */
export function useHighlights({
  engineRef,
  locationRef,
  work,
  fileSha,
  ready,
  labels,
  menuExtra,
}: {
  engineRef: React.RefObject<Engine | null>;
  locationRef: React.RefObject<Relocation | null>;
  work: WorkSnapshot;
  fileSha: string;
  ready: boolean;
  labels: Labels;
  /** further menu actions for the current selection or highlight (e.g. share as image) */
  menuExtra?: (target: { quote: string; annotation: Annotation | null }) => React.ReactNode;
}) {
  const rows = useLiveQuery(() => localDB().annotations.where("workSlug").equals(work.slug).toArray(), [work.slug]);
  const annotations = useMemo(() => (rows ?? []).filter((a) => a.fileSha === fileSha).sort(byPosition), [rows, fileSha]);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  // latest values for event handlers that live outside React (iframe listeners)
  const menuRef = useRef(menu);
  const editingRef = useRef(editing);
  const listRef = useRef(annotations);
  useLayoutEffect(() => {
    menuRef.current = menu;
    editingRef.current = editing;
    listRef.current = annotations;
  });

  // draw what is stored (only marks made on this exact file: CFIs are file-specific)
  useEffect(() => {
    const engine = engineRef.current;
    if (!ready || !engine) return;
    engine.setMarks(
      new Map<string, MarkStyle>(annotations.map((a) => [a.cfi, { color: a.color, style: a.style, note: Boolean(a.note) }])),
    );
  }, [annotations, ready, engineRef]);

  const say = useCallback((text: string, action?: ToastMessage["action"]) => setToast({ id: toastId(), text, action }), []);

  /** Called (debounced) when the selection inside the book changes. */
  const checkSelection = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const sel = engine.selection();
    const anchor = sel ? engine.screenRects(sel.range) : null;
    if (sel && anchor) setMenu({ kind: "selection", anchor, quote: sel.range.toString().replace(/\s+/g, " ").trim() });
    else setMenu((m) => (m?.kind === "selection" ? null : m));
  }, [engineRef]);

  /** A highlight was tapped. */
  const showMark = useCallback(
    (cfi: string) => {
      const engine = engineRef.current;
      const a = listRef.current.find((x) => x.cfi === cfi);
      const range = engine?.rangeFor(cfi);
      const anchor = range ? engine?.screenRects(range) : null;
      if (a && anchor) setMenu({ kind: "mark", id: a.id, anchor });
    },
    [engineRef],
  );

  const closeMenu = useCallback(() => setMenu(null), []);

  const current = menu?.kind === "mark" ? (annotations.find((a) => a.id === menu.id) ?? null) : null;

  const createFromSelection = async (patch: { color: HighlightColor; style: Annotation["style"] }) => {
    const engine = engineRef.current;
    const sel = engine?.selection();
    if (!engine || !sel) return null;
    const loc = locationRef.current;
    const a = await createAnnotation(work, fileSha, {
      cfi: sel.cfi,
      ...quoteOf(sel.range),
      ...patch,
      chapter: loc?.tocLabel ?? null,
      fraction: loc?.fraction ?? 0,
    });
    sel.doc.getSelection()?.removeAllRanges();
    return a;
  };

  const onColor = async (color: HighlightColor) => {
    rememberHighlightColor(color);
    if (menu?.kind === "selection") {
      const a = await createFromSelection({ color, style: "highlight" });
      if (a) setMenu({ kind: "mark", id: a.id, anchor: menu.anchor });
    } else if (current) {
      await updateAnnotation(current.id, { color, style: "highlight" });
    }
  };

  const onUnderline = async () => {
    if (menu?.kind === "selection") {
      const a = await createFromSelection({ color: lastHighlightColor(), style: "underline" });
      if (a) setMenu({ kind: "mark", id: a.id, anchor: menu.anchor });
    } else if (current) {
      await updateAnnotation(current.id, { style: current.style === "underline" ? "highlight" : "underline" });
    }
  };

  const onNote = async () => {
    if (menu?.kind === "selection") {
      const a = await createFromSelection({ color: lastHighlightColor(), style: "highlight" });
      if (a) setEditing(a.id);
    } else if (current) {
      setEditing(current.id);
    }
    setMenu(null);
  };

  const onCopy = async () => {
    const text = menu?.kind === "selection" ? menu.quote : (current?.quote ?? "");
    const ok = text ? await copyText(text) : false;
    if (ok) say(labels.copied);
    setMenu(null);
  };

  const onDelete = async () => {
    if (!current) return;
    const row = current;
    await deleteAnnotation(row.id);
    setMenu(null);
    say(labels.deleted, { label: labels.undo, onClick: () => void localDB().annotations.put(row) });
  };

  const editingRow = editing ? (annotations.find((a) => a.id === editing) ?? null) : null;

  const element = (
    <>
      {menu ? (
        <HighlightMenu
          state={menu}
          annotation={current}
          labels={labels}
          extra={menuExtra?.({ quote: menu.kind === "selection" ? menu.quote : (current?.quote ?? ""), annotation: current })}
          onColor={onColor}
          onUnderline={onUnderline}
          onNote={onNote}
          onCopy={onCopy}
          onDelete={onDelete}
        />
      ) : null}
      <NoteEditor
        annotation={editingRow}
        labels={labels}
        onClose={() => setEditing(null)}
        onSave={async (note) => {
          if (editingRow) await updateAnnotation(editingRow.id, { note });
          setEditing(null);
        }}
      />
      <Toast toast={toast} onDone={() => setToast(null)} className="bottom-20 pb-safe" />
    </>
  );

  return {
    annotations,
    element,
    checkSelection,
    showMark,
    closeMenu,
    say,
    /** a menu or the note editor is open: taps and keys belong to it, not to page turning */
    isOpen: () => menuRef.current !== null,
    isEditing: () => editingRef.current !== null,
  };
}
