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
