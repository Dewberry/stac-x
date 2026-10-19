import type { ReactNode } from "react";

/**
 * The header above one column of the home console. The three columns (the
 * collections rail, the selected collection, its map) each get one, and all
 * three share this shape: one line, the title (with a tag beside it when
 * there is one) on the left and the column's controls on the right. Same
 * shape in every column means the titles line up and the cards below all
 * start on the same line across the page. The grid in globals.css
 * (.sx-console) puts every header in its first row and every card in its
 * second, so a header's own height never moves a card. `lead` goes before
 * the title: the rail's toggle sits there in the collection header while the
 * rail is folded away.
 */
export function ColHead({ id, title, tag, lead, actions, label, className }: {
  id?: string;
  title: ReactNode;
  tag?: ReactNode;
  lead?: ReactNode;
  actions?: ReactNode;
  /** For a title that isn't plain words, what a screen reader should hear instead. */
  label?: string;
  /** Where the grid puts this header (sx-pane-head, sx-map-head). */
  className?: string;
}) {
  return (
    <header className={className ? `sx-colhead ${className}` : "sx-colhead"}>
      {lead}
      <h2 className="sx-colhead-title" id={id} aria-label={label}>
        <span className="sx-colhead-text">{title}</span>
        {tag != null && (
          <span className="sx-tag" data-tone="muted">
            {tag}
          </span>
        )}
      </h2>
      {actions && <div className="sx-colhead-actions">{actions}</div>}
    </header>
  );
}
