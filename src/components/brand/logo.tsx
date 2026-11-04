import { LOCKUP, WORDMARK_BENGALI, WORDMARK_LATIN } from "./wordmark.generated";
import { MARK_VIEWBOX, OPEN_ANGLE, PIVOT, leafPaths, openMarkOffset } from "./mark-geometry";

type MarkProps = { className?: string; title?: string };

/** Static open mark, coloured by `currentColor`. */
export function Mark({ className, title }: MarkProps) {
  const { left, right } = leafPaths();
  const dy = openMarkOffset();
  return (
    <svg
      viewBox={`0 0 ${MARK_VIEWBOX} ${MARK_VIEWBOX}`}
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      fill="currentColor"
      fillRule="evenodd"
    >
      <g transform={`translate(0 ${dy})`}>
        {[
          { side: left, angle: OPEN_ANGLE },
          { side: right, angle: -OPEN_ANGLE },
        ].map(({ side, angle }, i) => (
          <g key={i} transform={`rotate(${angle} ${PIVOT.x} ${PIVOT.y})`}>
            <path d={side.leaf} />
            {side.slivers.map((d, j) => (
              <path key={j} d={d} />
            ))}
          </g>
        ))}
      </g>
    </svg>
  );
}

type LogoProps = {
  className?: string;
  /** "full" shows the Bengali name line; "compact" only the Latin wordmark. */
  variant?: "full" | "compact";
  /** Colour classes for the mark (defaults to currentColor). */
  markClassName?: string;
};

/**
 * Horizontal lockup with the HarfBuzz-outlined wordmark, so the Bengali name is
 * shaped correctly before web fonts load. Inherits colour from the parent.
 */
export function Logo({ className, variant = "full", markClassName }: LogoProps) {
  const full = variant === "full";
  const width = full ? LOCKUP.width : LOCKUP.compactWidth;
  const height = full ? LOCKUP.height : 44;
  const markSize = full ? LOCKUP.mark : 44;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label="OpenBanglaBooks — ওপেন বাংলা বুকস"
      fill="currentColor"
    >
      <svg
        x={0}
        y={full ? (LOCKUP.height - LOCKUP.mark) / 2 : 0}
        width={markSize}
        height={markSize}
        viewBox={`0 0 ${MARK_VIEWBOX} ${MARK_VIEWBOX}`}
        className={markClassName}
      >
        <MarkGroup />
      </svg>
      <path d={WORDMARK_LATIN} transform={full ? undefined : "translate(-16 -9)"} />
      {full ? <path d={WORDMARK_BENGALI} fillOpacity={0.78} /> : null}
    </svg>
  );
}

function MarkGroup() {
  const { left, right } = leafPaths();
  return (
    <g transform={`translate(0 ${openMarkOffset()})`} fillRule="evenodd" fill="currentColor">
      {[
        { side: left, angle: OPEN_ANGLE },
        { side: right, angle: -OPEN_ANGLE },
      ].map(({ side, angle }, i) => (
        <g key={i} transform={`rotate(${angle} ${PIVOT.x} ${PIVOT.y})`}>
          <path d={side.leaf} />
          {side.slivers.map((d, j) => (
            <path key={j} d={d} />
          ))}
        </g>
      ))}
    </g>
  );
}
