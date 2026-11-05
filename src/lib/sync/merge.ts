/**
 * What to do with a row arriving from the server, given the local copy and
 * whether that copy has changes not pushed yet. Pure, unit tested.
 *
 * A device pushes before it pulls, so pending local changes here are only
 * the ones made while a sync was running. The rules mirror the server's:
 * last writer wins, except that a note is never lost.
 */

export type LocalState =
  | { kind: "none" }
  | { kind: "row"; updatedAt: number; serverUpdatedAt?: number; note?: string | null; pending: boolean }
  /** deleted here, not pushed yet */
  | { kind: "deleted"; changedAt: number; base?: number };

export type Incoming = { updatedAt: number; deleted: boolean; note?: string | null };

export type Decision =
  /** write the server row (or delete locally); any pending local change is superseded */
  | "apply"
  /** keep the local row; only note the server version as seen */
  | "keep"
  /** the server row wins; keep the local version as a copy (new id), to be pushed */
  | "apply-copy-local"
  /** the local row wins; keep the server version as a copy (new id), to be pushed */
  | "keep-copy-server";

const text = (s: string | null | undefined) => (s ?? "").trim();

export function decide(local: LocalState, incoming: Incoming, withNotes = false): Decision {
  if (local.kind === "none") return "apply";

  if (local.kind === "deleted") {
    // a note changed elsewhere after this device last saw it outlives the delete
    if (withNotes && !incoming.deleted && text(incoming.note) && incoming.updatedAt > (local.base ?? 0)) return "apply";
    return incoming.updatedAt > local.changedAt ? "apply" : "keep";
  }

  // nothing pending here: the server's copy is the truth (it may even be
  // "older" than ours, when the server clamped a fast clock)
  if (!local.pending) return "apply";

  // our own change coming back
  if (incoming.updatedAt === local.updatedAt) return "keep";

  if (withNotes) {
    const changedElsewhere = incoming.updatedAt > (local.serverUpdatedAt ?? 0);
    if (incoming.deleted) {
      // deleted elsewhere while a note was being written here: the note wins
      if (text(local.note) && changedElsewhere) return "keep";
    } else if (changedElsewhere && text(local.note) && text(incoming.note) && text(local.note) !== text(incoming.note)) {
      return local.updatedAt > incoming.updatedAt ? "keep-copy-server" : "apply-copy-local";
    }
  }

  return incoming.updatedAt > local.updatedAt ? "apply" : "keep";
}
