/** A turning ring, for the moments the app is reading something. */
export function Spinner({ size = "sm" }: { size?: "sm" | "lg" }) {
  return <span className={`sx-spinner${size === "lg" ? " sx-spinner-lg" : ""}`} aria-hidden="true" />;
}

/** The spinner with a line beside it, centered in whatever is still empty. */
export function Loading({ children }: { children: React.ReactNode }) {
  return (
    <p className="sx-loading" role="status">
      <Spinner size="lg" />
      <span>{children}</span>
    </p>
  );
}

/**
 * One gray bar where something is still on its way, as wide as `w`. Inside a
 * text element it takes that element's line height, so a row of bars is as
 * tall as the row it stands for (styles/loading.css).
 */
export function Skel({ w, className = "" }: { w: string; className?: string }) {
  return <span className={`sx-skel ${className}`} style={{ "--w": w } as React.CSSProperties} />;
}
