import { ENVS, type EnvKey } from "@/lib/env";
import { qcMeta } from "@/lib/stac";

/**
 * Where a collection stands across the three environments, left to right in
 * the order it moves: a filled step where it has arrived, a hollow one where
 * it hasn't yet, and the QC status in each place it has. The environment the
 * page is showing is marked.
 */
export function PromotionPath({
  current,
  stages,
}: {
  current: EnvKey;
  /** One per environment; qc is null where the collection isn't present. */
  stages: { env: EnvKey; qc: string | null }[];
}) {
  return (
    <ol className="sx-path" aria-label="Where this collection is">
      {ENVS.map((e) => {
        const s = stages.find((x) => x.env === e.key);
        const here = s?.qc != null;
        return (
          <li key={e.key} className="sx-path-step" data-env={e.key} data-here={here} aria-current={e.key === current ? "step" : undefined}>
            <span className="sx-path-mark" aria-hidden="true" />
            <span className="sx-path-name">{e.label}</span>
            <span className="sx-path-state">{here ? qcMeta(s!.qc).label : "Not yet"}</span>
          </li>
        );
      })}
    </ol>
  );
}
