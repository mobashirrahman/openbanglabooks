"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { localDB, type WorkSnapshot } from "@/lib/local/db";
import { createEngine, warmEngine, type Engine, type Relocation } from "@/lib/reader/engine";
import { loadEpubBytes, OfflineError } from "@/lib/reader/epub-loader";
import { columnsFor, frameSize, pageGeometry } from "@/lib/reader/layout";
import { installFontFaces, readerCss } from "@/lib/reader/styles";
import { THEMES, type ReaderTurn } from "@/lib/reader/settings";
import { curlSupported, fadeTurn, startCurl } from "@/lib/reader/page-curl";
import type { TouchHandler } from "@/lib/reader/engine";
import { useReaderSettings } from "@/lib/reader/use-reader-settings";
import { useFullscreen } from "@/lib/reader/use-fullscreen";
import { addBookmark, getPosition, savePosition, touchOpened } from "@/lib/reader/persistence";
import type { Locale } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n/dictionaries/bn";
import { ReaderChrome, type ReaderSheet } from "./reader-chrome";
import { menuButtonClass } from "./highlight-menu";
import { Image as ImageIcon, Search } from "lucide-react";
import { QuoteCardDialog, type QuoteTarget } from "./quote-card-dialog";
import { BookFrame } from "./book-frame";
import { DeskRail } from "./desk-rail";
import { ReaderStatus } from "./reader-status";
import { OpeningCover } from "./opening-cover";
import { useHighlights } from "./use-highlights";
import { useReadingTime } from "./use-reading-time";
import { t } from "@/lib/i18n/t";
import { formatNumber, formatPercent } from "@/lib/i18n/format";
import { applyHighlightTheme } from "@/lib/reader/annotations";

export type ReaderProps = {
  work: WorkSnapshot & { title_en: string };
  fileSha: string;
  /** null for a reader's own book: its file is only in IndexedDB */
  fileUrl: string | null;
  bookHref: string;
  locale: Locale;
  labels: Dictionary["reader"] & { back: string; retry: string; undo: string; deleted: string; allNotes: string; notesHref: string };
  initial: { href?: string | null; cfi?: string | null };
  next: { slug: string; title_bn: string; href: string }[];
};

type Phase = "loading" | "ready" | "error" | "offline";
const MOBILE_MAX = 700;

/** A pointer press on the book: where and when it began, and whether text was selected then. */
type Press = { x: number; y: number; t: number; selecting: boolean };
const pressOf = (e: PointerEvent, selecting: boolean): Press => ({ x: e.screenX, y: e.screenY, t: Date.now(), selecting });
/** Short and still: a tap, not a drag, a swipe or a long press. */
const isTap = (press: Press | null, e: MouseEvent) =>
  !press || (Math.hypot(e.screenX - press.x, e.screenY - press.y) <= 10 && Date.now() - press.t <= 500);
/**
 * True for a pointer that really moved on screen. When content slides or fades
 * under a resting mouse (a page turn, controls hiding), browsers send
 * mousemove events with an unchanged screen position: those must not wake the
 * controls, or they would reappear on every turn.
 */
let lastPointer = { x: NaN, y: NaN };
function pointerReallyMoved(e: { screenX: number; screenY: number }) {
  const moved = Math.abs(e.screenX - lastPointer.x) + Math.abs(e.screenY - lastPointer.y) > 2;
  lastPointer = { x: e.screenX, y: e.screenY };
  return moved && window.matchMedia("(hover: hover)").matches;
}

/**
 * A link's target place (?cfi= or ?at=), read in the browser. The server reads
 * it too; this covers a reader page opened offline from the service worker's
 * copy, which was kept without the query.
 */
function initialFromUrl(): { href: string | null; cfi: string | null } {
  const sp = new URLSearchParams(window.location.search);
  const at = sp.get("at");
  const cfi = sp.get("cfi");
  return {
    href: at && /^[\w./#-]{1,200}$/.test(at) ? at : null,
    cfi: cfi && cfi.startsWith("epubcfi(") && cfi.length < 500 ? cfi : null,
  };
}

const hasSelection = (doc: Document) => {
  const sel = doc.getSelection();
  return Boolean(sel && !sel.isCollapsed && sel.toString().trim());
};

export function Reader(props: ReaderProps) {
  const { work, fileSha, fileUrl, labels, locale } = props;
  const [settings, updateSettings] = useReaderSettings();
  const fullscreen = useFullscreen();
  const [phase, setPhase] = useState<Phase>("loading");
  const [location, setLocation] = useState<Relocation | null>(null);
  const [chrome, setChrome] = useState(true);
  const [sheet, setSheet] = useState<ReaderSheet>(null);
  const [searchSeed, setSearchSeed] = useState({ q: "", n: 0 });
  const [quoteTarget, setQuoteTarget] = useState<QuoteTarget | null>(null);
  const [ended, setEnded] = useState(false);
  const [stage, setStage] = useState({ width: 0, height: 0 });
  const [attempt, setAttempt] = useState(0);
  // every page turn gets a new id, which replays the leaf shadow
  const [sweep, setSweep] = useState<{ id: number; dir: 1 | -1 } | null>(null);

  const engineRef = useRef<Engine | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const locationRef = useRef<Relocation | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastLayout = useRef("");
  const restoring = useRef<string | null>(null);
  const restoreToken = useRef(0);
  const phaseRef = useRef<Phase>("loading");
  /** when this device last moved in the book (another device's newer place is offered) */
  const movedAt = useRef(0);
  const lastCss = useRef("");
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const columnsRef = useRef<1 | 2>(1);

  // ── highlights and notes ──────────────────────────────────────────────────
  const hl = useHighlights({
    engineRef,
    locationRef,
    work,
    fileSha,
    ready: phase === "ready",
    labels,
    menuExtra: ({ quote }) =>
      quote ? (
        <>
          {/* a short selection can be looked up in the whole book */}
          {quote.length <= 40 ? (
            <button
              type="button"
              aria-label={labels.search}
              className={menuButtonClass}
              onClick={() => {
                setSearchSeed((s) => ({ q: quote, n: s.n + 1 }));
                setSheet("search");
                hlRef.current.closeMenu();
              }}
            >
              <Search aria-hidden className="size-[18px]" />
            </button>
          ) : null}
          <button
            type="button"
            aria-label={labels.shareQuote}
            className={menuButtonClass}
            onClick={() => {
              setQuoteTarget({
                quote,
                title: work.title_bn,
                author: work.authors[0]?.name_bn ?? "",
                variant: work.cover_variant,
                slug: work.slug,
              });
              hlRef.current.closeMenu();
            }}
          >
            <ImageIcon aria-hidden className="size-[18px]" />
          </button>
        </>
      ) : null,
  });
  const hlRef = useRef(hl);
  hlRef.current = hl;

  // ── reading time: daily goal, and the time left in chapter and book ───────
  const reading = useReadingTime({
    location,
    active: phase === "ready" && !ended,
    onGoalReached: (minutes) => hl.say(t(labels.goalReached, { minutes: formatNumber(minutes, locale) })),
  });
  const bumpRef = useRef(reading.bump);
  bumpRef.current = reading.bump;

  const reducedMotion = useMemo(
    () => typeof window !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );
  phaseRef.current = phase;
  const theme = THEMES[settings.theme];
  const mobile = stage.width > 0 && stage.width < MOBILE_MAX;
  const columns = mobile ? 1 : columnsFor(stage.width, stage.height, settings.layout);
  columnsRef.current = columns;

  // ── stage size ────────────────────────────────────────────────────────────
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setStage({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── persistence ───────────────────────────────────────────────────────────
  const flush = useCallback(
    (finished?: boolean) => {
      const loc = locationRef.current;
      if (!loc?.cfi) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = null;
      void savePosition(work, fileSha, { cfi: loc.cfi, fraction: loc.fraction, chapter: loc.tocLabel, finished });
    },
    [work, fileSha],
  );

  useEffect(() => {
    const onHide = () => document.visibilityState === "hidden" && flush();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", () => flush());
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [flush]);

  // ── chrome auto-hide (desktop: shows on pointer movement) ────────────────
  const showChrome = useCallback((ms = 2800) => {
    setChrome(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      // never pull the controls away from under keyboard focus
      if (document.activeElement?.closest("[data-reader-chrome]")) return;
      setChrome(false);
    }, ms);
  }, []);

  // ── how pages turn ────────────────────────────────────────────────────────
  const pageRef = useRef<HTMLDivElement>(null);
  const flapRef = useRef<HTMLDivElement>(null);
  const shadeRef = useRef<HTMLDivElement>(null);
  const creaseRef = useRef<HTMLDivElement>(null);
  const lastTurnEnd = useRef(0);
  const turnStyle = useCallback((): ReaderTurn => {
    const s = settingsRef.current;
    if (s.flow === "scrolled" || s.turn === "none") return "none";
    if (reducedMotion) return "fade"; // never a moving page for reduced motion
    if ((s.turn === "curl" || s.turn === "fade") && !curlSupported()) return "slide";
    return s.turn;
  }, [reducedMotion]);
  const curlSetup = () => {
    const page = pageRef.current;
    const flap = flapRef.current;
    const shade = shadeRef.current;
    const crease = creaseRef.current;
    if (!page || !flap || !shade || !crease) return null;
    return {
      els: { page, flap, shade, crease },
      layout: { box: { w: page.clientWidth, h: page.clientHeight }, spread: columnsRef.current === 2 },
      paper: THEMES[settingsRef.current.theme].paper,
    };
  };

  // ── navigation ────────────────────────────────────────────────────────────
  // foliate ignores a turn requested while the previous one is still running
  // (which includes loading the next chapter). A tap must never be lost, so
  // one turn asked for meanwhile is remembered and runs right after.
  const turning = useRef(false);
  const queuedTurn = useRef<0 | 1 | -1>(0);
  const turn = useCallback(
    async function turnPage(dir: 1 | -1): Promise<void> {
      const engine = engineRef.current;
      if (!engine) return;
      if (turning.current) {
        queuedTurn.current = dir;
        return;
      }
      if (dir === 1 && locationRef.current?.atEnd) {
        setEnded(true);
        flush(true);
        return;
      }
      const style = turnStyle();
      if (style === "slide") setSweep((s) => ({ id: (s?.id ?? 0) + 1, dir }));
      setChrome(false);
      hlRef.current.closeMenu();
      turning.current = true;
      try {
        const go = () => (dir === 1 ? engine.next() : engine.prev());
        const curl = style === "curl" ? curlSetup() : null;
        if (curl) {
          // flipping quickly through pages: shorter curls
          const quick = Date.now() - lastTurnEnd.current < 400;
          await startCurl({ ...curl, dir, change: go, revert: () => (dir === 1 ? engine.prev() : engine.next()), duration: quick ? 340 : 560 })
            .done;
        } else if (style === "fade" && pageRef.current) await fadeTurn(pageRef.current, go);
        else await go(); // slide: foliate animates; none: instant
      } finally {
        turning.current = false;
        lastTurnEnd.current = Date.now();
      }
      const queued = queuedTurn.current;
      queuedTurn.current = 0;
      if (queued && engineRef.current === engine) await turnPage(queued);
    },
    [flush, turnStyle],
  );

  // ── swipes: horizontal on every page-turn style; the curl also follows the finger ──
  // One handler owns touches on the book while reading paginated. A horizontal
  // gesture turns a page (with the curl dragged under the finger when that is
  // the chosen style); vertical gestures are left to the browser, so selecting
  // text and zooming still behave natively. Foliate's own swipe is bypassed:
  // a swipe and a tap then always run through the same, queued turn.
  type Gesture = {
    start: { x: number; y: number };
    t: number;
    /** which way the finger is going, once it has moved far enough to tell */
    intent: "h" | "v" | null;
    turn: ReturnType<typeof startCurl> | null;
    dir: 1 | -1;
    /** a selection (or the start of the book): not a page turn */
    blocked: boolean;
  };
  const gesture = useRef<Gesture | null>(null);
  const onTouch: TouchHandler = (phase, pt, e) => {
    // scrolled mode is the browser's own scrolling, never a page turn
    if (settingsRef.current.flow === "scrolled") return false;
    if (phase === "start") {
      if (e.touches.length > 1) return (gesture.current = null), false; // pinch zoom is not ours
      gesture.current = {
        start: pt,
        t: Date.now(),
        intent: null,
        turn: null,
        dir: 1,
        blocked: anySelection(), // with text selected a gesture dismisses it, it does not turn
      };
      return true;
    }
    const g = gesture.current;
    if (!g) return phase === "move";
    if (phase === "end") {
      clearTimeout(dragWatchdog.current);
      gesture.current = null;
      if (e.type === "touchcancel") {
        void g.turn?.cancel(); // the gesture was interrupted: lay the leaf back
        return true;
      }
      if (g.turn) {
        void g.turn.release();
        return true;
      }
      const dx = pt.x - g.start.x;
      // a deliberate flick (or the edge of the book) turns a page for slide/fade/none
      if (g.intent === "h" && !g.blocked && (Math.abs(dx) >= 22 || locationRef.current?.atEnd)) void turnRef.current(g.dir);
      return true;
    }
    if (e.touches.length > 1) {
      void g.turn?.cancel();
      gesture.current = null;
      return false;
    }
    if (g.intent === "v" || g.blocked) return true;
    const dx = pt.x - g.start.x;
    const dy = pt.y - g.start.y;
    if (!g.intent) {
      // a small dead zone keeps taps and text selection intact
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return true;
      if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) * 1.1) {
        g.intent = "v";
        return true;
      }
      if (anySelection()) return (g.blocked = true), true; // the long press won: selecting text
      g.intent = "h";
      g.dir = dx < 0 ? 1 : -1;
      const loc = locationRef.current;
      const engine = engineRef.current;
      if (!engine || (g.dir === -1 && loc?.atStart)) return (g.blocked = true), true;
      // at the very end a forward swipe still asks for the end screen (turn() shows it)
      const curl = turnStyle() === "curl" && !turning.current && !(g.dir === 1 && loc?.atEnd) ? curlSetup() : null;
      if (curl && engine) {
        const r = curl.els.page.getBoundingClientRect();
        setChrome(false);
        hlRef.current.closeMenu();
        turning.current = true;
        g.turn = startCurl({
          ...curl,
          dir: g.dir,
          change: () => (g.dir === 1 ? engine.next() : engine.prev()),
          revert: () => (g.dir === 1 ? engine.prev() : engine.next()),
          drag: { start: [g.start.x - r.left, g.start.y - r.top] },
        });
        void g.turn.done.finally(() => {
          turning.current = false;
          lastTurnEnd.current = Date.now();
        });
      } else if (!turning.current) {
        setChrome(false);
        hlRef.current.closeMenu();
      }
    }
    if (g.intent === "h") {
      if (e.cancelable) e.preventDefault(); // the page follows the finger instead of the view scrolling
      if (g.turn) {
        const r = pageRef.current!.getBoundingClientRect();
        g.turn.moveTo([pt.x - r.left, pt.y - r.top]);
        // if the finger's frame goes away (the turn crossed into a new chapter, whose iframe
        // replaced the one the touch began in), its remaining events never arrive: let go
        clearTimeout(dragWatchdog.current);
        const turnNow = g.turn;
        dragWatchdog.current = setTimeout(() => {
          if (gesture.current?.turn === turnNow) {
            void turnNow.release();
            gesture.current = null;
          }
        }, 1200);
      }
      return true;
    }
    return true;
  };
  const dragWatchdog = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const touchRef = useRef(onTouch);
  touchRef.current = onTouch;

  // ── open the book ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let engine: (Engine & { start(): Promise<void> }) | null = null;
    (async () => {
      try {
        warmEngine();
        const [bytes, saved] = await Promise.all([loadEpubBytes(fileSha, fileUrl), getPosition(work.slug, fileSha)]);
        if (cancelled || !hostRef.current) return;
        const initial = props.initial.cfi || props.initial.href ? props.initial : initialFromUrl();
        const cfi = initial.cfi ?? (initial.href ? null : saved?.cfi) ?? null;
        movedAt.current = (await localDB().positions.get(work.slug))?.updatedAt ?? 0;
        engine = await createEngine(
          hostRef.current,
          bytes,
          { initialCfi: cfi, initialHref: initial.href ?? null },
          {
            onRelocate: (r) => {
              locationRef.current = r;
              if (phaseRef.current === "ready") movedAt.current = Date.now();
              setLocation(r);
              if (saveTimer.current) clearTimeout(saveTimer.current);
              saveTimer.current = setTimeout(() => flush(), 500);
            },
            onLoad: (doc) => {
              installFontFaces(doc, window.location.origin);
              attachDocHandlers(doc);
            },
            onShowMark: (cfi) => hlRef.current.showMark(cfi),
          },
        );
        if (cancelled) {
          engine.destroy();
          return;
        }
        engineRef.current = engine;
        engine.setTouchHandler((phase, pt, e) => touchRef.current(phase, pt, e));
        lastLayout.current = "";
        lastCss.current = "";
        applyPresentation(engine);
        await engine.start();
        if (!cfi && !initial.href) {
          // resume a book whose file changed since last time by progress fraction
          const any = await localDB().positions.get(work.slug);
          if (any && any.fileSha !== fileSha && any.fraction > 0) await engine.goToFraction(any.fraction);
        }
        void touchOpened(work.slug);
        setPhase("ready");
        showChrome(2400);
      } catch (e) {
        if (cancelled) return;
        console.error(e);
        setPhase(e instanceof OfflineError ? "offline" : "error");
      }
    })();
    return () => {
      cancelled = true;
      flush();
      engine?.destroy();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileSha, fileUrl, attempt]);

  // ── presentation: styles + layout follow settings and stage size ─────────
  const applyPresentation = useCallback(
    (engine: Engine) => {
      const s = settingsRef.current;
      const el = stageRef.current;
      const width = el?.clientWidth ?? window.innerWidth;
      const height = el?.clientHeight ?? window.innerHeight;
      const isMobile = width < MOBILE_MAX;
      const cols = isMobile ? 1 : columnsFor(width, height, s.layout);
      const frame = frameSize(width, height, cols, isMobile);
      const g = pageGeometry(frame.width, frame.height, cols, s.margin, isMobile);
      const layout = {
        flow: s.flow,
        gap: g.gap,
        margin: g.margin,
        // the frame already has the page proportions; let text fill it
        maxInlineSize: `${Math.ceil(frame.width / cols) + 4}px`,
        maxBlockSize: `${frame.height}px`,
        maxColumnCount: cols,
        animated: s.turn === "slide" && !reducedMotion, // foliate's own slide; other styles turn instantly underneath
      };
      // every layout attribute change re-renders the section; only touch what changed
      const layoutKey = JSON.stringify(layout);
      const css = readerCss(s);
      const layoutChanged = layoutKey !== lastLayout.current;
      const cssChanged = css !== lastCss.current;
      if (!layoutChanged && !cssChanged) return;
      hlRef.current.closeMenu(); // its anchor moves with the text
      // remember where the reader is *before* reflowing (positions are CFIs, never pages)
      const anchor = restoring.current ?? locationRef.current?.cfi ?? null;
      if (layoutChanged) {
        lastLayout.current = layoutKey;
        engine.setLayout(layout);
      }
      if (cssChanged) {
        lastCss.current = css;
        engine.setStyles(css);
      }
      if (anchor && phaseRef.current === "ready") {
        restoring.current = anchor;
        const token = ++restoreToken.current;
        const docs = engine.contents().map((c) => c.doc);
        void Promise.all(docs.map((d) => d.fonts?.ready))
          .then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
          .then(async () => {
            if (token !== restoreToken.current) return; // a newer change will restore instead
            await engine.goTo(anchor);
            restoring.current = null;
          });
      }
    },
    [reducedMotion],
  );

  useEffect(() => {
    if (engineRef.current && phase === "ready") applyPresentation(engineRef.current);
  }, [settings, stage.width, stage.height, phase, applyPresentation]);

  // ── taps on the book ──────────────────────────────────────────────────────
  // The outer quarters of the book turn pages and the middle toggles the
  // controls; a tap on the desk beside the book counts as its outer edge (on
  // an iPad in landscape the screen edge is desk, not page). Taps arrive from
  // two places: the section iframe (the text) and the stage around it (the
  // desk, and foliate's page margins, which live in its shadow DOM outside
  // the iframe – on a phone exactly where a thumb taps "back").
  const turnRef = useRef(turn);
  turnRef.current = turn;
  const tapAt = useCallback((clientX: number) => {
    const rect = hostRef.current?.getBoundingClientRect();
    if (!rect?.width) return;
    const x = (clientX - rect.left) / rect.width;
    if (x < 0.25) void turnRef.current(-1);
    else if (x > 0.75) void turnRef.current(1);
    else setChrome((c) => !c);
  }, []);
  // While a page turn's transition is on screen its overlay takes every tap, so the
  // tap lands on <html> instead of the book (and WebKit sends no click for it at
  // all). Someone flipping quickly taps again before the leaf has settled: those
  // taps still turn pages, read from pointerdown/pointerup.
  //
  // A tap can also straddle a turn's start or end: pressed on the book and
  // released on the overlay that appeared meanwhile, or the other way round.
  // The browser then sends no click to either, so every press is noted here
  // (anyPress, in screen coordinates, the same in the book's frames): a
  // release on the overlay completes any press, and a press that began on
  // the overlay is completed wherever in the page it is released.
  const anyPress = useRef<Press | null>(null);
  const overlayPress = useRef(false);
  useEffect(() => {
    const root = document.documentElement;
    const turning = () => root.dataset.curl !== undefined || root.dataset.fade !== undefined;
    const onDown = (e: PointerEvent) => {
      overlayPress.current = e.target === root && turning();
      if (overlayPress.current) anyPress.current = pressOf(e, false); // presses on the book are noted by its own handlers
    };
    const onUp = (e: PointerEvent) => {
      const start = anyPress.current;
      const fromOverlay = overlayPress.current;
      anyPress.current = null;
      overlayPress.current = false;
      // released on the overlay, or (pressed on it) on the page once the overlay had gone: no click follows either way
      if (!start || (e.target !== root && !fromOverlay) || start.selecting || !isTap(start, e)) return;
      if (e.target !== root && (e.target as Element).closest?.("button, a")) return; // the desk's own controls
      // the same rule as on the book itself: with text selected, a tap only dismisses it
      if (anySelectionRef.current()) for (const c of engineRef.current?.contents() ?? []) c.doc.getSelection()?.removeAllRanges();
      else tapAt(e.clientX);
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("pointerup", onUp, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("pointerup", onUp, true);
    };
  }, [tapAt]);
  const anySelection = () => engineRef.current?.contents().some((c) => hasSelection(c.doc)) ?? false;
  const anySelectionRef = useRef(anySelection);
  anySelectionRef.current = anySelection;
  const hostPress = useRef<Press | null>(null);
  const onHostPointerDown = (e: React.PointerEvent) => {
    hostPress.current = pressOf(e.nativeEvent, anySelection());
    anyPress.current = hostPress.current;
    overlayPress.current = false;
  };
  const onHostClick = (e: React.MouseEvent) => {
    const press = hostPress.current;
    hostPress.current = null;
    if ((e.target as Element).closest("button, a")) return; // the desk's own controls
    if (hlRef.current.isOpen()) return hlRef.current.closeMenu(); // the first tap closes the highlight menu
    if (press?.selecting || anySelection()) {
      // the first tap dismisses the selection (a click outside the frame does not)
      for (const c of engineRef.current?.contents() ?? []) c.doc.getSelection()?.removeAllRanges();
      return;
    }
    if (isTap(press, e.nativeEvent)) tapAt(e.clientX);
  };

  // ── input inside the book (iframe documents) ─────────────────────────────
  const attachDocHandlers = useCallback(
    (doc: Document) => {
      let press: Press | null = null;
      // the selection is read on pointerdown: by the time `click` fires, the
      // press itself has already collapsed it
      doc.addEventListener("pointerdown", (e) => {
        press = pressOf(e, hasSelection(doc));
        anyPress.current = press;
        overlayPress.current = false;
        bumpRef.current(); // reading, not away
      });
      doc.addEventListener("click", (e) => {
        const start = press;
        press = null;
        if ((e.target as Element | null)?.closest?.("a[href]")) return; // links are handled by the engine
        if (start?.selecting || hasSelection(doc)) return; // dismissing or making a selection, not turning
        if (engineRef.current?.hitsMark(doc, e.clientX, e.clientY)) return; // a highlight: the engine opens its menu
        if (hlRef.current.isOpen()) return hlRef.current.closeMenu();
        if (!isTap(start, e)) return;
        const frame = doc.defaultView?.frameElement as HTMLElement | null;
        tapAt((frame?.getBoundingClientRect().left ?? 0) + e.clientX);
      });
      // a selection opens the highlight menu once it settles (touch handles keep adjusting it)
      let selTimer: ReturnType<typeof setTimeout> | undefined;
      doc.addEventListener("selectionchange", () => {
        clearTimeout(selTimer);
        selTimer = setTimeout(() => hlRef.current.checkSelection(), 220);
      });
      doc.addEventListener("keydown", (e) => handleKey(e));
      doc.addEventListener("mousemove", (e) => {
        if (pointerReallyMoved(e)) showChromeRef.current();
      });
      doc.addEventListener(
        "wheel",
        (e) => {
          if (settingsRef.current.flow === "scrolled") return;
          wheelTurn(e);
        },
        { passive: true },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const showChromeRef = useRef(() => showChrome());
  showChromeRef.current = () => showChrome();

  const wheelLock = useRef(0);
  const wheelTurn = (e: WheelEvent) => {
    const now = Date.now();
    if (now - wheelLock.current < 450) return;
    const delta = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (Math.abs(delta) < 12) return;
    wheelLock.current = now;
    void turnRef.current(delta > 0 ? 1 : -1);
  };

  const sheetRef = useRef(sheet);
  sheetRef.current = sheet;
  const quoteRef = useRef(quoteTarget);
  quoteRef.current = quoteTarget;
  const fullscreenRef = useRef(fullscreen);
  fullscreenRef.current = fullscreen;
  function handleKey(e: KeyboardEvent) {
    if (sheetRef.current || hlRef.current.isEditing() || quoteRef.current) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
      e.preventDefault(); // the book's own search, which also looks in chapters not yet on screen
      setSheet("search");
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.key) {
      case "ArrowRight":
      case "PageDown":
        e.preventDefault();
        void turnRef.current(1);
        break;
      case " ":
        e.preventDefault();
        void turnRef.current(e.shiftKey ? -1 : 1);
        break;
      case "ArrowLeft":
      case "PageUp":
        e.preventDefault();
        void turnRef.current(-1);
        break;
      case "/":
        e.preventDefault();
        setSheet("search");
        break;
      case "t":
      case "T":
        setSheet("toc");
        break;
      case "f":
      case "F":
        if (fullscreenRef.current.supported) {
          e.preventDefault();
          void fullscreenRef.current.toggle();
        }
        break;
      case "Escape":
        if (hlRef.current.isOpen()) {
          hlRef.current.closeMenu();
          for (const c of engineRef.current?.contents() ?? []) c.doc.getSelection()?.removeAllRanges();
        } else setChrome((c) => !c);
        break;
    }
  }
  useEffect(() => {
    // Who owns a key is decided when it goes down (capture phase, before any dialog
    // reacts): Escape that closes a sheet must not also toggle the controls – by the
    // time it bubbles here the sheet has already closed itself.
    let dialogOwnsKey = false;
    const onKeyCapture = () => {
      dialogOwnsKey = Boolean(sheetRef.current || hlRef.current.isEditing() || quoteRef.current || document.querySelector('[role="dialog"][data-state="open"]'));
    };
    const onKey = (e: KeyboardEvent) => {
      if (dialogOwnsKey) return;
      const el = e.target as HTMLElement;
      if (/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(el.tagName) && e.key === " ") return;
      if (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return; // typing, not reading
      handleKey(e);
    };
    window.addEventListener("keydown", onKeyCapture, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKeyCapture, true);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // ── bookmarks ─────────────────────────────────────────────────────────────
  const bookmarks = useLiveQuery(
    () => localDB().bookmarks.where("workSlug").equals(work.slug).sortBy("fraction"),
    [work.slug],
  );
  const currentBookmark = useMemo(() => {
    if (!location?.range || !bookmarks?.length || !engineRef.current) return null;
    return (
      bookmarks.find((b) => {
        if (b.fileSha !== fileSha) return false;
        const r = engineRef.current!.rangeFor(b.cfi);
        if (!r || r.startContainer.ownerDocument !== location.range!.startContainer.ownerDocument) return false;
        try {
          // the bookmark starts on this page: page start ≤ bookmark start ≤ page end
          return (
            location.range!.compareBoundaryPoints(Range.START_TO_START, r) <= 0 &&
            location.range!.compareBoundaryPoints(Range.START_TO_END, r) >= 0
          );
        } catch {
          return false;
        }
      }) ?? null
    );
  }, [location, bookmarks, fileSha]);

  const toggleBookmark = useCallback(async () => {
    const loc = locationRef.current;
    if (!loc) return;
    if (currentBookmark) {
      await localDB().bookmarks.delete(currentBookmark.id);
      return;
    }
    const excerpt = (loc.range?.toString() ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
    await addBookmark(work, fileSha, { cfi: loc.cfi, fraction: loc.fraction, chapter: loc.tocLabel, excerpt });
  }, [currentBookmark, work, fileSha]);

  const goTo = useCallback(async (target: string) => {
    setSheet(null);
    setEnded(false);
    hlRef.current.closeMenu();
    await engineRef.current?.goTo(target);
  }, []);
  const searchBook = useCallback((q: string) => engineRef.current!.search(q), []);
  const clearSearch = useCallback(() => engineRef.current?.clearSearch(), []);
  const goToFraction = useCallback(async (f: number) => {
    setEnded(false);
    await engineRef.current?.goToFraction(f);
  }, []);

  // ── another device's place ────────────────────────────────────────────────
  // Read further on the phone, then opened the laptop? Offer that place,
  // without moving the book on its own. Offered once per remote position.
  const remotePlaces = useLiveQuery(() => localDB().remotePositions.where("workSlug").equals(work.slug).toArray(), [work.slug]);
  const offered = useRef(new Set<string>());
  useEffect(() => {
    if (phase !== "ready" || !remotePlaces?.length) return;
    const here = locationRef.current;
    const newest = remotePlaces.filter((p) => p.updatedAt > movedAt.current).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (!here || !newest) return;
    const key = `${newest.id}@${newest.updatedAt}`;
    if (offered.current.has(key) || Math.abs(newest.fraction - here.fraction) < 0.01) return;
    offered.current.add(key);
    hlRef.current.say(
      t(labels.otherDevice, { device: newest.deviceLabel ?? "—", percent: formatPercent(newest.fraction, locale) }),
      { label: labels.goThere, onClick: () => void (newest.fileSha === fileSha ? goTo(newest.cfi) : goToFraction(newest.fraction)) },
      12000,
    );
  }, [phase, remotePlaces, fileSha, goTo, goToFraction, labels, locale]);

  const frame = frameSize(stage.width, stage.height, columns, mobile);
  // desk beside the book; a wide margin can carry the chapter rail without ever crowding the page
  const desk = Math.max(0, (stage.width - frame.width) / 2);

  // theme variables live on <html> so portalled sheets (rendered under <body>) share them
  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty("--paper", theme.paper);
    root.setProperty("--ink", theme.ink);
    root.setProperty("--ink-muted", theme.muted);
    root.setProperty("--desk", theme.desk);
    root.background = theme.desk;
    document.documentElement.dataset.readerTheme = settings.theme;
    document.documentElement.dataset.theme = settings.theme === "dark" ? "dark" : "light";
    applyHighlightTheme(document.documentElement, settings.theme === "dark");
  }, [theme, settings.theme]);

  return (
    <div
      className="reader fixed inset-0 select-none"
      data-columns={columns}
      data-phase={phase}
      data-ended={ended || undefined}
      data-cfi={location?.cfi}
      data-fraction={location ? location.fraction.toFixed(4) : undefined}
      data-section={location?.sectionIndex}
      data-chars-left={location?.charsLeft ? `${location.charsLeft.chapter},${location.charsLeft.book}` : undefined}
      data-visible={location?.range ? location.range.toString().replace(/\s+/g, " ").trim().slice(0, 3000) : undefined}
      style={
        {
          background: theme.desk,
          color: theme.ink,
          transition: "background-color 300ms var(--ease-paper)",
        } as React.CSSProperties
      }
    >
      <div
        ref={stageRef}
        className="absolute inset-0 pt-safe pb-safe"
        onPointerDown={onHostPointerDown}
        onClick={onHostClick}
      >
        <BookFrame
          width={frame.width}
          height={frame.height}
          columns={columns}
          mobile={mobile}
          fraction={location?.fraction ?? 0}
          sweep={reducedMotion || settings.turn !== "slide" ? null : sweep}
          edgeButtons={desk >= 90}
          pageRef={pageRef}
          flapRef={flapRef}
          shadeRef={shadeRef}
          creaseRef={creaseRef}
          dark={settings.theme === "dark"}
          onEdge={(dir) => void turn(dir)}
          labels={{ prev: labels.prevPage, next: labels.nextPage }}
        >
          <div ref={hostRef} className="absolute inset-0" />
        </BookFrame>
      </div>

      {phase === "ready" && !mobile && desk >= 120 ? (
        <DeskRail
          toc={engineRef.current?.toc ?? []}
          bookmarks={bookmarks ?? []}
          fraction={location?.fraction ?? 0}
          currentHref={location?.tocHref ?? null}
          top={Math.round((stage.height - frame.height) / 2 + frame.height * 0.04)}
          height={Math.round(frame.height * 0.92)}
          right={Math.max(10, Math.round((desk - 40) / 2))}
          dimmed={!chrome}
          labels={{ contents: labels.contents, bookmarks: labels.bookmarks, chapterOf: labels.chapterOf }}
          onGoTo={goTo}
        />
      ) : null}

      {phase === "ready" ? (
        <ReaderChrome
          visible={chrome || sheet !== null}
          locale={locale}
          work={work}
          bookHref={props.bookHref}
          labels={labels}
          location={location}
          toc={engineRef.current?.toc ?? []}
          sectionFractions={engineRef.current?.sectionFractions ?? []}
          bookmarks={bookmarks ?? []}
          annotations={hl.annotations}
          timeLeft={reading.timeLeft}
          bookmarked={Boolean(currentBookmark)}
          onToggleBookmark={toggleBookmark}
          sheet={sheet}
          onSheet={setSheet}
          searchSeed={searchSeed}
          onSearch={searchBook}
          onClearSearch={clearSearch}
          settings={settings}
          onSettings={updateSettings}
          fullscreen={fullscreen}
          columnsAvailable={!mobile && columnsFor(stage.width, stage.height, "spread") === 2}
          onGoTo={goTo}
          onGoToFraction={goToFraction}
          onPointerActivity={(e) => pointerReallyMoved(e) && showChrome(4000)}
        />
      ) : null}

      {phase === "ready" ? hl.element : null}
      <QuoteCardDialog target={quoteTarget} labels={labels} onClose={() => setQuoteTarget(null)} />
      <OpeningCover work={work} ready={phase === "ready"} reducedMotion={reducedMotion} />
      <p role="status" className="sr-only">
        {phase === "loading" ? labels.loading : null}
      </p>

      <ReaderStatus
        phase={phase}
        ended={ended}
        labels={labels}
        work={work}
        bookHref={props.bookHref}
        next={props.next}
        onRetry={() => {
          setPhase("loading");
          setAttempt((a) => a + 1);
        }}
        onBackToBook={() => setEnded(false)}
      />
    </div>
  );
}
