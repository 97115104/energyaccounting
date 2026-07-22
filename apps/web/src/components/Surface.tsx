import type { ElementType, HTMLAttributes } from "react";

type SurfaceProps<T extends ElementType = "div"> = {
  /** Element tag to render. Defaults to div. */
  as?: T;
  className?: string;
} & Omit<HTMLAttributes<HTMLElement>, "as" | "className">;

/**
 * Nested inset card that tracks the sky via `--surface` (stats, weather,
 * task rows, and any future inset). Prefer this over hardcoding #fff.
 */
export function Surface<T extends ElementType = "div">({
  as,
  className,
  ...rest
}: SurfaceProps<T>) {
  const Tag = (as ?? "div") as ElementType;
  return <Tag className={["surface", className].filter(Boolean).join(" ")} {...rest} />;
}
