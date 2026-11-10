"use server";

import { redirect } from "next/navigation";
import { updateTag } from "next/cache";
import { CATALOG_TAG } from "@/lib/catalog/queries";
import { isLocale, localizedPath, type Locale } from "@/lib/i18n/config";
import { AdminError, requireEditor, type EditorSession } from "./auth";
import { parseAuthor, parseEdition, parseTerm, parseWork, type FieldError } from "./forms";

/**
 * Catalog edits. Every action authorises itself (requireEditor) and
 * validates its input; writes go through the editor's own session, so row
 * level security checks them a second time. The public catalog is cached
 * by tag and refreshed after each change.
 */

export type FormError = FieldError | "taken" | "rightsRequired";
export type Message = "forbidden" | "signedOut" | "failed" | "inUse" | "onlyDrafts" | "saved";
export type FormState = { status: "idle" | "saved" | "error"; errors?: Record<string, FormError>; message?: Message; at?: number };

type DbError = { code?: string; message?: string; details?: string } | null;

const localeOf = (fd: FormData): Locale => {
  const l = String(fd.get("locale") ?? "bn");
  return isLocale(l) ? l : "bn";
};

async function session(): Promise<EditorSession | FormState> {
  try {
    return await requireEditor();
  } catch (e) {
    if (e instanceof AdminError) return { status: "error", message: e.code === "signed-out" ? "signedOut" : "forbidden", at: Date.now() };
    throw e;
  }
}
const isState = (x: EditorSession | FormState): x is FormState => "status" in x;

function failure(error: DbError, slugField = "slug"): FormState {
  const at = Date.now();
  if (error?.code === "23505") return { status: "error", errors: { [slugField]: "taken" }, at };
  if (error?.code === "23503") return { status: "error", message: "inUse", at };
  if (error?.code === "42501") return { status: "error", message: "forbidden", at };
  console.error("admin write failed", error);
  return { status: "error", message: "failed", at };
}

const saved = (): FormState => ({ status: "saved", message: "saved", at: Date.now() });

// ── works ──────────────────────────────────────────────────────────────────

export async function saveWork(_: FormState, fd: FormData): Promise<FormState> {
  const s = await session();
  if (isState(s)) return s;
  const parsed = parseWork(fd);
  if (!parsed.ok) return { status: "error", errors: parsed.errors, at: Date.now() };
  const { data, error } = await s.supabase.rpc("admin_save_work", { p: parsed.value });
  if (error) return failure(error);
  updateTag(CATALOG_TAG);
  if (!parsed.value.id) redirect(localizedPath(localeOf(fd), `/admin/works/${data as string}`));
  return saved();
}

export async function deleteWork(_: FormState, fd: FormData): Promise<FormState> {
  const s = await session();
  if (isState(s)) return s;
  const id = String(fd.get("id") ?? "");
  // published or withdrawn works stay (readers may have them in their library): withdraw instead
  const { data, error } = await s.supabase.from("works").delete().eq("id", id).eq("status", "draft").select("id");
  if (error) return failure(error);
  if (!data?.length) return { status: "error", message: "onlyDrafts", at: Date.now() };
  updateTag(CATALOG_TAG);
  redirect(localizedPath(localeOf(fd), "/admin"));
}

// ── authors ────────────────────────────────────────────────────────────────

export async function saveAuthor(_: FormState, fd: FormData): Promise<FormState> {
  const s = await session();
  if (isState(s)) return s;
  const parsed = parseAuthor(fd);
  if (!parsed.ok) return { status: "error", errors: parsed.errors, at: Date.now() };
  const { id, ...row } = parsed.value;
  const { data, error } = id
    ? await s.supabase.from("authors").update(row).eq("id", id).select("id").single()
    : await s.supabase.from("authors").insert(row).select("id").single();
  if (error) return failure(error);
  updateTag(CATALOG_TAG);
  if (!id) redirect(localizedPath(localeOf(fd), `/admin/authors/${data.id}`));
  return saved();
}

export async function deleteAuthor(_: FormState, fd: FormData): Promise<FormState> {
  const s = await session();
  if (isState(s)) return s;
  const { error } = await s.supabase.from("authors").delete().eq("id", String(fd.get("id") ?? ""));
  if (error) return failure(error); // 23503: still credited on a work
  updateTag(CATALOG_TAG);
  redirect(localizedPath(localeOf(fd), "/admin/authors"));
}

// ── editions and files ─────────────────────────────────────────────────────

export async function saveEdition(_: FormState, fd: FormData): Promise<FormState> {
  const s = await session();
  if (isState(s)) return s;
  const parsed = parseEdition(fd);
  if (!parsed.ok) return { status: "error", errors: parsed.errors, at: Date.now() };
  const { data, error } = await s.supabase.rpc("admin_save_edition", { p: parsed.value });
  if (error) return failure(error);
  updateTag(CATALOG_TAG);
  if (!parsed.value.id) redirect(localizedPath(localeOf(fd), `/admin/editions/${data as string}`));
  return saved();
}

export async function deleteEdition(_: FormState, fd: FormData): Promise<FormState> {
  const s = await session();
  if (isState(s)) return s;
  const workId = String(fd.get("work_id") ?? "");
  const { data, error } = await s.supabase.from("editions").delete().eq("id", String(fd.get("id") ?? "")).eq("status", "draft").select("id");
  if (error) return failure(error);
  if (!data?.length) return { status: "error", message: "onlyDrafts", at: Date.now() };
  updateTag(CATALOG_TAG);
  redirect(localizedPath(localeOf(fd), `/admin/works/${workId}`));
}

export async function makeFileCurrent(_: FormState, fd: FormData): Promise<FormState> {
  const s = await session();
  if (isState(s)) return s;
  const { error } = await s.supabase.rpc("admin_make_file_current", { file: String(fd.get("file") ?? "") });
  if (error) return failure(error);
  updateTag(CATALOG_TAG);
  return saved();
}

/** After an upload (a route handler, which cannot update tags immediately). */
export async function catalogChanged(): Promise<void> {
  await requireEditor();
  updateTag(CATALOG_TAG);
}

// ── genres and collections ────────────────────────────────────────────────

async function saveTerm(table: "genres" | "collections", fd: FormData): Promise<FormState> {
  const s = await session();
  if (isState(s)) return s;
  const parsed = parseTerm(fd, table === "collections");
  if (!parsed.ok) return { status: "error", errors: parsed.errors, at: Date.now() };
  const { id, status, ...rest } = parsed.value;
  const row = table === "collections" ? { ...rest, status } : rest;
  const { error } = id ? await s.supabase.from(table).update(row).eq("id", id) : await s.supabase.from(table).insert(row);
  if (error) return failure(error);
  updateTag(CATALOG_TAG);
  return saved();
}

async function deleteTerm(table: "genres" | "collections", fd: FormData): Promise<FormState> {
  const s = await session();
  if (isState(s)) return s;
  const { error } = await s.supabase.from(table).delete().eq("id", String(fd.get("id") ?? ""));
  if (error) return failure(error);
  updateTag(CATALOG_TAG);
  return saved();
}

export async function saveGenre(_: FormState, fd: FormData) {
  return saveTerm("genres", fd);
}
export async function deleteGenre(_: FormState, fd: FormData) {
  return deleteTerm("genres", fd);
}
export async function saveCollection(_: FormState, fd: FormData) {
  return saveTerm("collections", fd);
}
export async function deleteCollection(_: FormState, fd: FormData) {
  return deleteTerm("collections", fd);
}
