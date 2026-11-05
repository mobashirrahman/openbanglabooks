import "server-only";
import { cache } from "react";
import { connection } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { open, seal } from "./crypto";

/**
 * A reader's connections, read and written as that reader (their cookie
 * session): the database functions only ever touch the caller's own rows,
 * and only ciphertext crosses into the database (see the connections
 * migration). No service-role key is involved.
 */

export type Provider = "hardcover" | "readwise";

export type ConnectionErrorCode = "signedOut" | "notConfigured" | "notConnected" | "reconnect" | "rejected" | "rateLimited" | "upstream" | "busy";
export class ConnectionError extends Error {
  constructor(
    readonly code: ConnectionErrorCode,
    readonly retryAfter?: number,
    detail?: string,
  ) {
    super(detail ?? code);
  }
}

/** The signed-in reader, checked with the auth server; once per request. */
export const reader = cache(async function reader() {
  await connection();
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) throw new ConnectionError("signedOut");
  return { sb, uid: user.id };
});

const context = (uid: string, p: Provider) => `connection:${uid}:${p}`;

export type ConnectionInfo = { provider: Provider; label: string | null; connectedAt: string; lastUsedAt: string | null };

export async function listConnections(): Promise<ConnectionInfo[]> {
  const { sb } = await reader();
  const { data, error } = await sb.rpc("connection_list");
  if (error) throw new ConnectionError("upstream", undefined, error.message);
  return (data as { provider: Provider; account_label: string | null; connected_at: string; last_used_at: string | null }[]).map((r) => ({
    provider: r.provider,
    label: r.account_label,
    connectedAt: r.connected_at,
    lastUsedAt: r.last_used_at,
  }));
}

export async function saveConnection(p: Provider, value: unknown, label: string | null, expiresAt: number | null) {
  const { sb, uid } = await reader();
  const secret = await seal(value, context(uid, p));
  const { error } = await sb.rpc("connection_save", {
    p_provider: p,
    p_secret: secret,
    p_label: label?.slice(0, 200) ?? null,
    p_expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
  });
  if (error) throw new ConnectionError("upstream", undefined, error.message);
}

export async function loadConnection<T>(p: Provider): Promise<{ value: T; version: number; leased: boolean } | null> {
  const { sb, uid } = await reader();
  const { data, error } = await sb.rpc("connection_secret", { p_provider: p });
  if (error) throw new ConnectionError("upstream", undefined, error.message);
  const row = (data as { secret: string; version: number; leased: boolean }[])[0];
  if (!row) return null;
  return { value: await open<T>(row.secret, context(uid, p)), version: row.version, leased: row.leased };
}

/** The right to refresh the tokens, for one request at a time; null if another holds it. */
export async function leaseConnection<T>(p: Provider): Promise<{ value: T; version: number } | null> {
  const { sb, uid } = await reader();
  const { data, error } = await sb.rpc("connection_lease", { p_provider: p, p_seconds: 30 });
  if (error) throw new ConnectionError("upstream", undefined, error.message);
  const row = (data as { secret: string; version: number }[])[0];
  return row ? { value: await open<T>(row.secret, context(uid, p)), version: row.version } : null;
}

export async function rotateConnection(p: Provider, version: number, value: unknown, expiresAt: number | null): Promise<boolean> {
  const { sb, uid } = await reader();
  const { data, error } = await sb.rpc("connection_rotate", {
    p_provider: p,
    p_version: version,
    p_secret: await seal(value, context(uid, p)),
    p_expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
  });
  if (error) throw new ConnectionError("upstream", undefined, error.message);
  return data === true;
}

export async function releaseConnection(p: Provider) {
  const { sb } = await reader();
  await sb.rpc("connection_release", { p_provider: p });
}

export async function markUsed(p: Provider) {
  const { sb } = await reader();
  await sb.rpc("connection_used", { p_provider: p });
}

export async function deleteConnection(p: Provider) {
  const { sb } = await reader();
  const { error } = await sb.rpc("connection_delete", { p_provider: p });
  if (error) throw new ConnectionError("upstream", undefined, error.message);
}

/** Sealing a short-lived value for this reader (the OAuth state cookie). */
export const sealFor = (uid: string, purpose: string, value: unknown) => seal(value, `${purpose}:${uid}`);
export const openFor = <T>(uid: string, purpose: string, sealed: string) => open<T>(sealed, `${purpose}:${uid}`);
