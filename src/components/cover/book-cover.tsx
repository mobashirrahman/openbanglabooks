import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { CLOTHS } from "./cloths";
import { PersonalCoverImage } from "./personal-cover";

/**
 * Original cloth-bound covers, generated from a work's metadata.
 *
 * No scanned or third-party artwork is used (no cover-rights questions), and
 * every book in the library shares one material language: book cloth, a
 * darker hinge at the spine, and brass foil stamping. Six cloths × six motifs
 * drawn from Bengali book-making and architecture give each title its own face.
 * Text is live (correct Bengali shaping at any size) and aria-hidden – the
 * surrounding markup always carries the accessible title.
 */



/** Title centre (top %), author baseline (bottom %) and left inset per motif. */
const LAYOUT = [
  { title: 42, author: 12, left: 16 },
  { title: 50, author: 6, left: 14 },
  { title: 76, author: 6, left: 14 },
  { title: 39, author: 9, left: 22 },
  { title: 45, author: 9, left: 24 },
  { title: 60, author: 6, left: 22 },
] as const;


export type CoverWork = {
  slug: string;
  title_bn: string;
  subtitle_bn?: string | null;
  cover_variant: number;
  authors: { name_bn: string }[];
};

type Props = {
  work: CoverWork;
  className?: string;
  /** visual size hint; text scales with the cover via container units */
  style?: CSSProperties;
  /** raise on hover (for interactive contexts) */
  interactive?: boolean;
};

export function BookCover({ work, className, style, interactive = false }: Props) {
  // cover_variant is assigned in catalog order, so neighbouring books differ in
  // both cloth and motif; 36 distinct combinations before any repeat.
  const v = Math.abs(work.cover_variant);
  const { cloth, foil } = CLOTHS[v % CLOTHS.length];
  const motif = (v + Math.floor(v / 6)) % 6;
  const title = work.title_bn;
  const len = [...title].length;
  // the paper label (motif 3) is narrower than the cloth, so its type steps down sooner
  const titleSize = (len <= 4 ? 17 : len <= 7 ? 14 : len <= 11 ? 11.5 : 9.5) * (motif === 3 ? 0.82 : 1);
  const author = work.authors[0]?.name_bn ?? "";
  const layout = LAYOUT[motif];

  return (
    <div
      aria-hidden
      data-cover={work.slug}
      className={cn(
        "book-cover relative aspect-[2/3] w-full overflow-hidden rounded-r-[3px] rounded-l-[1px] select-none",
        "shadow-book [container-type:inline-size]",
        interactive &&
          "transition-[transform,box-shadow] duration-300 ease-paper will-change-transform group-hover:-translate-y-1 group-hover:shadow-book-lift group-active:translate-y-0 group-active:duration-100",
        className,
      )}
      style={{ ...style, ["--cloth" as string]: cloth, ["--foil" as string]: foil, background: cloth }}
    >
      {/* cloth weave + light falling from the top left */}
      <div className="absolute inset-0 [background-image:repeating-linear-gradient(0deg,rgb(255_255_255/0.025)_0_1px,transparent_1px_3px),repeating-linear-gradient(90deg,rgb(0_0_0/0.04)_0_1px,transparent_1px_3px)]" />
      <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_20%_0%,rgb(255_255_255/0.12),transparent_60%)]" />
      {/* hinge: the spine side is darker with a fold highlight */}
      <div className="absolute inset-y-0 left-0 w-[7%] bg-[linear-gradient(90deg,rgb(0_0_0/0.32),rgb(0_0_0/0.12)_70%,rgb(255_255_255/0.10)_88%,rgb(0_0_0/0.10))]" />

      <Motif motif={motif} />

      <div
        className="absolute flex -translate-y-1/2 flex-col items-center text-center"
        style={{ top: `${layout.title}%`, left: `${layout.left}%`, right: motif === 3 ? "22%" : "12%", color: motif === 3 ? "#2A2620" : "var(--foil)" }}
      >
        <span className="font-display leading-[1.3] [text-wrap:balance]" style={{ fontSize: `${titleSize}cqw` }}>
          {title}
        </span>
        {work.subtitle_bn ? (
          <span className="mt-[2cqw] font-display opacity-85" style={{ fontSize: "6.5cqw" }}>
            {work.subtitle_bn}
          </span>
        ) : null}
      </div>
      <span
        className="absolute text-center font-sans leading-snug"
        style={{ bottom: `${layout.author}%`, left: `${layout.left}%`, right: "12%", fontSize: "5.6cqw", color: "var(--foil)", opacity: 0.88 }}
      >
        {author}
      </span>
      {work.slug.startsWith("mine-") ? <PersonalCoverImage id={work.slug} /> : null}
    </div>
  );
}

/** Foil-stamped ornaments, drawn in a 200×300 box. */
function Motif({ motif }: { motif: number }) {
  const common = {
    viewBox: "0 0 200 300",
    preserveAspectRatio: "none" as const,
    className: "absolute inset-0 h-full w-full",
    fill: "none",
    stroke: "var(--foil)",
  };
  switch (motif) {
    case 0: // double-rule frame with corner holes
      return (
        <svg {...common}>
          <rect x="24" y="18" width="160" height="264" strokeWidth="1.6" opacity="0.9" />
          <rect x="30" y="24" width="148" height="252" strokeWidth="0.7" opacity="0.8" />
          {[
            [40, 34],
            [168, 34],
            [40, 266],
            [168, 266],
          ].map(([cx, cy]) => (
            <circle key={`${cx}${cy}`} cx={cx} cy={cy} r="2.4" fill="var(--foil)" stroke="none" />
          ))}
        </svg>
      );
    case 1: // library bands
      return (
        <svg {...common}>
          {[44, 256].map((y) => (
            <g key={y} opacity="0.9">
              <line x1="14" x2="200" y1={y - 7} y2={y - 7} strokeWidth="0.8" />
              <line x1="14" x2="200" y1={y} y2={y} strokeWidth="5" />
              <line x1="14" x2="200" y1={y + 7} y2={y + 7} strokeWidth="0.8" />
            </g>
          ))}
        </svg>
      );
    case 2: // alpana lozenge
      return (
        <svg {...common}>
          <g opacity="0.9" transform="translate(104 112)">
            <path d="M0 -70 L56 0 L0 70 L-56 0 Z" strokeWidth="1.6" />
            <path d="M0 -54 L43 0 L0 54 L-43 0 Z" strokeWidth="0.7" />
            <path d="M0 -24 L19 0 L0 24 L-19 0 Z" fill="var(--foil)" stroke="none" opacity="0.85" />
            {[0, 90, 180, 270].map((a) => (
              <circle key={a} cx={Math.sin((a * Math.PI) / 180) * 36} cy={-Math.cos((a * Math.PI) / 180) * 36} r="2.6" fill="var(--foil)" stroke="none" />
            ))}
          </g>
        </svg>
      );
    case 3: // punthi-leaf paper label with two string holes
      return (
        <svg {...common}>
          <rect x="30" y="58" width="148" height="118" rx="6" fill="#EFE6D3" stroke="none" opacity="0.96" />
          <rect x="36" y="64" width="136" height="106" rx="3" stroke="#2A2620" strokeWidth="0.6" opacity="0.5" />
          <circle cx="45" cy="117" r="3.6" fill="var(--cloth)" stroke="none" />
          <circle cx="163" cy="117" r="3.6" fill="var(--cloth)" stroke="none" />
        </svg>
      );
    case 4: // ribbed spine band and a single rule
      return (
        <svg {...common}>
          <g opacity="0.85">
            {Array.from({ length: 9 }, (_, i) => (
              <line key={i} x1="20" x2="20" y1={30 + i * 30} y2={46 + i * 30} strokeWidth="4" />
            ))}
            <line x1="34" x2="34" y1="18" y2="282" strokeWidth="0.8" />
            <line x1="40" x2="186" y1="248" y2="248" strokeWidth="0.8" />
          </g>
        </svg>
      );
    default: // do-chala: the curved roof of Bengal's temples
      return (
        <svg {...common}>
          <g opacity="0.9">
            <path d="M22 96 Q104 30 186 96" strokeWidth="1.6" />
            <path d="M32 100 Q104 46 176 100" strokeWidth="0.7" />
            <path d="M40 100 V262 H168 V100" strokeWidth="0.9" />
            <path d="M104 52 V40" strokeWidth="1.4" />
            <circle cx="104" cy="36" r="3" fill="var(--foil)" stroke="none" />
          </g>
        </svg>
      );
  }
}
