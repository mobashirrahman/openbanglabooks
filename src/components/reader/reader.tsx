"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { localDB, type WorkSnapshot } from "@/lib/local/db";
import { createEngine, type Engine, type Relocation } from "@/lib/reader/engine";
import { loadEpubBytes, OfflineError } from "@/lib/reader/epub-loader";
import { columnsFor, frameSize, pageGeometry } from "@/lib/reader/layout";
import { installFontFaces, readerCss } from "@/lib/reader/styles";
import { THEMES } from "@/lib/reader/settings";
import { useReaderSettings } from "@/lib/reader/use-reader-settings";
import { addBookmark, getPosition, savePosition, touchOpened } from "@/lib/reader/persistence";
import type { Locale } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n/dictionaries/bn";
import { ReaderChrome } from "./reader-chrome";
import { BookFrame } from "./book-frame";
import { ReaderStatus } from "./reader-status";
import { OpeningCover } from "./opening-cover";

export type ReaderProps = {
  work: WorkSnapshot & { title_en: string };
  fileSha: string;
  fileUrl: string;
  bookHref: string;
  locale: Locale;
  labels: Dictionary["reader"] & { back: string; retry: string };
  initial: { href?: string | null; cfi?: string | null };
  next: { slug: string; title_bn: string; href: string }[];
};

type Phase = "loading" | "ready" | "error" | "offline";
const MOBILE_MAX = 700;

export function Reader(props: ReaderProps) {
  const { work, fileSha, fileUrl, labels, locale } = props;
  const [settings, updateSettings] = useReaderSettings();
  const [phase, setPhase] = useState<Phase>("loading");
  const [location, setLocation] = useState<Relocation | null>(null);
  const [chrome, setChrome] = useState(true);
  const [sheet, setSheet] = useState<null | "toc" | "settings">(null);
  const [ended, setEnded] = useState(false);
  const [stage, setStage] = useState({ width: 0, height: 0 });
  const [attempt, setAttempt] = useState(0);
  const [turnDir, setTurnDir] = useState<0 | 1 | -1>(0);

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
  const lastCss = useRef("");
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const reducedMotion = useMemo(
    () => typeof window !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );
  phaseRef.current = phase;
  const theme = THEMES[settings.theme];
  const mobile = stage.width > 0 && stage.width < MOBILE_MAX;
  const columns = mobile ? 1 : columnsFor(stage.width, stage.height, settings.layout);

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
    hideTimer.current = setTimeout(() => setChrome(false), ms);
  }, []);

  // ── navigation ────────────────────────────────────────────────────────────
  const turn = useCallback(
    async (dir: 1 | -1) => {
      const engine = engineRef.current;
      if (!engine) return;
      if (dir === 1 && locationRef.current?.atEnd) {
        setEnded(true);
        flush(true);
        return;
      }
      setTurnDir(dir);
      setChrome(false);
      await (dir === 1 ? engine.next() : engine.prev());
    },
    [flush],
  );

  // ── open the book ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let engine: (Engine & { start(): Promise<void> }) | null = null;
    setPhase("loading");
    (async () => {
      try {
        const [bytes, saved] = await Promise.all([loadEpubBytes(fileSha, fileUrl), getPosition(work.slug, fileSha)]);
        if (cancelled || !hostRef.current) return;
        const cfi = props.initial.cfi ?? (props.initial.href ? null : saved?.cfi) ?? null;
        engine = await createEngine(
          hostRef.current,
          bytes,
          { initialCfi: cfi, initialHref: props.initial.href ?? null },
          {
            onRelocate: (r) => {
              locationRef.current = r;
              setLocation(r);
              setTurnDir(0);
              if (saveTimer.current) clearTimeout(saveTimer.current);
              saveTimer.current = setTimeout(() => flush(), 500);
            },
            onLoad: (doc) => {
              installFontFaces(doc, window.location.origin);
              attachDocHandlers(doc);
            },
          },
        );
        if (cancelled) {
          engine.destroy();
          return;
        }
        engineRef.current = engine;
        lastLayout.current = "";
        lastCss.current = "";
        applyPresentation(engine);
        await engine.start();
        if (!cfi && !props.initial.href) {
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
        animated: s.animations && !reducedMotion,
      };
      // every layout attribute change re-renders the section; only touch what changed
      const layoutKey = JSON.stringify(layout);
      const css = readerCss(s);
      const layoutChanged = layoutKey !== lastLayout.current;
      const cssChanged = css !== lastCss.current;
      if (!layoutChanged && !cssChanged) return;
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

  // ── input inside the book (iframe documents) ─────────────────────────────
  const turnRef = useRef(turn);
  turnRef.current = turn;
  const attachDocHandlers = useCallback(
    (doc: Document) => {
      let down: { x: number; y: number; t: number } | null = null;
      doc.addEventListener("pointerdown", (e) => {
        down = { x: e.screenX, y: e.screenY, t: Date.now() };
      });
      doc.addEventListener("click", (e) => {
        const start = down;
        down = null;
        if ((e.target as Element | null)?.closest?.("a[href]")) return; // links are handled by the engine
        const sel = doc.getSelection();
        if (sel && !sel.isCollapsed && sel.toString().trim()) return; // selecting text, not turning
        if (start && (Math.hypot(e.screenX - start.x, e.screenY - start.y) > 10 || Date.now() - start.t > 500)) return;
        const frame = doc.defaultView?.frameElement as HTMLElement | null;
        const left = (frame?.getBoundingClientRect().left ?? 0) + e.clientX;
        const w = window.innerWidth;
        if (left < w * 0.25) void turnRef.current(-1);
        else if (left > w * 0.75) void turnRef.current(1);
        else setChrome((c) => !c);
      });
      doc.addEventListener("keydown", (e) => handleKey(e));
      doc.addEventListener("mousemove", () => {
        if (window.matchMedia("(hover: hover)").matches) showChromeRef.current();
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
  function handleKey(e: KeyboardEvent) {
    if (sheetRef.current) return;
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
      case "t":
      case "T":
        setSheet("toc");
        break;
      case "Escape":
        setChrome((c) => !c);
        break;
    }
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(el.tagName) && e.key === " ") return;
      if (el.tagName === "INPUT") return;
      handleKey(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          return (
            location.range!.compareBoundaryPoints(Range.START_TO_START, r) <= 0 &&
            location.range!.compareBoundaryPoints(Range.END_TO_START, r) >= 0
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
    await engineRef.current?.goTo(target);
  }, []);
  const goToFraction = useCallback(async (f: number) => {
    setEnded(false);
    await engineRef.current?.goToFraction(f);
  }, []);

  const frame = frameSize(stage.width, stage.height, columns, mobile);

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
      data-visible={location?.range ? location.range.toString().replace(/\s+/g, " ").trim().slice(0, 3000) : undefined}
      style={
        {
          background: theme.desk,
          color: theme.ink,
          transition: "background-color 300ms var(--ease-paper)",
        } as React.CSSProperties
      }
    >
      <div ref={stageRef} className="absolute inset-0 pt-safe pb-safe">
        <BookFrame
          width={frame.width}
          height={frame.height}
          columns={columns}
          mobile={mobile}
          fraction={location?.fraction ?? 0}
          turnDir={reducedMotion || !settings.animations ? 0 : turnDir}
          dark={settings.theme === "dark"}
          onEdge={(dir) => void turn(dir)}
          labels={{ prev: labels.prevPage, next: labels.nextPage }}
        >
          <div ref={hostRef} className="absolute inset-0" />
        </BookFrame>
      </div>

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
          bookmarked={Boolean(currentBookmark)}
          onToggleBookmark={toggleBookmark}
          sheet={sheet}
          onSheet={setSheet}
          settings={settings}
          onSettings={updateSettings}
          columnsAvailable={!mobile && columnsFor(stage.width, stage.height, "spread") === 2}
          onGoTo={goTo}
          onGoToFraction={goToFraction}
          onPointerActivity={() => showChrome(4000)}
        />
      ) : null}

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
        onRetry={() => setAttempt((a) => a + 1)}
        onBackToBook={() => setEnded(false)}
      />
    </div>
  );
}
