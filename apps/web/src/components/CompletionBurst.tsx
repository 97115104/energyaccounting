import type { CSSProperties } from "react";

/**
 * Short-lived CSS burst anchored near a completed checkbox.
 * Purely decorative; parent owns mount/unmount timing.
 */
export function CompletionBurst(props: {
  tier: "small" | "medium" | "rare";
  side: "deposit" | "withdrawal";
  x: number;
  y: number;
  quip: string | null;
}) {
  const specks =
    props.tier === "small"
      ? 0
      : props.tier === "medium"
        ? 6
        : 10;
  const baseDist = props.tier === "rare" ? 22 : 18;
  const step = props.tier === "rare" ? 10 : 8;

  return (
    <div
      className={`completion-burst completion-burst-${props.tier} completion-burst-${props.side}`}
      style={{ left: props.x, top: props.y }}
      aria-hidden="true"
    >
      <span className="completion-burst-ring" />
      {Array.from({ length: specks }, (_, i) => {
        const style = {
          "--angle": `${(360 / specks) * i}deg`,
          "--dist": `${baseDist + (i % 3) * step}px`,
          animationDelay: `${i * 18}ms`,
        } as CSSProperties;
        return <span key={i} className="completion-burst-speck" style={style} />;
      })}
      {props.quip && <span className="completion-burst-quip">{props.quip}</span>}
    </div>
  );
}
