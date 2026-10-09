import { ENVS, type EnvKey } from "@/lib/env";
import { qcMeta } from "@/lib/stac";

/** One environment's place on the path; qc is null where the collection isn't present. */
export type PathStage = { env: EnvKey; qc: string | null; at?: string | null };

/**
 * Where a collection stands across the three environments, left to right in
 * the order it moves. It's a stepper, not a control: a filled green dot where
 * it was approved, a ringed one where you are, a hollow one where it hasn't
 * arrived, and the line between two steps turns green once the collection
 * has been approved through it. The state is always in words under the dot,
 * so nothing rests on the color.
 */
export function PromotionPath({
  current,
  stages,
  here,
}: {
  current: EnvKey;
  stages: PathStage[];
  /** The line under the current step while it's waiting: "You're reviewing here". */
  here?: string;
}) {
  const at = ENVS.map((e) => stages.find((s) => s.env === e.key) ?? { env: e.key, qc: null });
  return (
    <ol className="sx-path" aria-label="Where this collection is">
      {at.map((s, i) => {
        const e = ENVS[i];
        const present = s.qc != null;
        const isCurrent = e.key === current;
        const done = present && s.qc === "approved" && !isCurrent;
        const into = i > 0 && at[i - 1].qc === "approved" && present;
        const outOf = i < at.length - 1 && s.qc === "approved" && at[i + 1].qc != null;
        const meta = qcMeta(s.qc);
        const sub = !present
          ? "Not yet"
          : isCurrent && s.qc === "pending" && here
            ? here
            : [meta.label, s.qc !== "pending" && s.at ? fmtDay(s.at) : null].filter(Boolean).join(" · ");
        return (
          <li
            key={e.key}
            className="sx-path-step"
            data-state={present ? s.qc : "absent"}
            data-done={done || undefined}
            data-in={into || undefined}
            data-out={outOf || undefined}
            aria-current={isCurrent ? "step" : undefined}
          >
            <span className="sx-path-mark" aria-hidden="true" />
            <span className="sx-path-name">{e.label}</span>
            <span className="sx-path-state">{sub}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** "Aug 18" from a date or timestamp, read in UTC so server and browser agree. */
export function fmtDay(v: string): string {
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00Z` : v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
