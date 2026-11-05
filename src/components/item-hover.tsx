"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { FeatureCollection } from "geojson";
import { DataMap, type MapProps } from "./map";
import { MapBoundary } from "./map-boundary";

/**
 * One shared "item pointed at" for a page whose map and list show the same
 * items. The collection page's two models of one basin draw as one shape,
 * so pointing at a row is how you see which shape is which, and pointing at
 * the map finds the row.
 */

export type ItemHover = { hovered: string | null; setHovered: (id: string | null) => void };

/** Exported for a page that keeps the hovered item itself (the home console, which maps it to a shape on its map). */
export const ItemHoverContext = createContext<ItemHover>({ hovered: null, setHovered: () => {} });
const Ctx = ItemHoverContext;

export function ItemHoverProvider({ children }: { children: ReactNode }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const value = useMemo(() => ({ hovered, setHovered }), [hovered]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Outside a provider this is inert, so a list or map works alone too. */
export function useItemHover(): ItemHover {
  return useContext(Ctx);
}

type Fetched = { src: string; status: "done" | "error"; data?: FeatureCollection };

/**
 * The page map, joined to the list's hover.
 *
 * `src` is where the features are when they were too heavy to come with
 * the page (lib/item-features.ts). The map opens on the extent it was
 * given and the features are drawn when they arrive; until then, and if
 * they never do, the readout under the map says so, and so does a status
 * line for screen readers.
 */
export function LinkedMap({ src, ...props }: Omit<MapProps, "hovered" | "onHover"> & { src?: string }) {
  const { hovered, setHovered } = useItemHover();
  const [fetched, setFetched] = useState<Fetched | null>(null);
  useEffect(() => {
    if (!src) return;
    const ac = new AbortController();
    fetch(src, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.statusText))))
      .then((data: FeatureCollection) => setFetched({ src, status: "done", data }))
      .catch((e: Error) => {
        if (e.name !== "AbortError") setFetched({ src, status: "error" });
      });
    return () => ac.abort();
  }, [src]);
  // What was fetched for another collection's page doesn't count for this one.
  const got = src && fetched?.src === src ? fetched : null;
  const waiting = !!src && !got;
  const failed = got?.status === "error";
  return (
    <>
      {src && (
        <p className="sr-only" role="status">
          {waiting ? "Loading the items onto the map." : failed ? "The items couldn't be loaded onto the map." : "The items are on the map."}
        </p>
      )}
      <MapBoundary label={props.label}>
        <DataMap
          {...props}
          data={got?.data ?? props.data}
          hint={waiting ? "Loading the items…" : failed ? "The items couldn't be loaded onto the map." : props.hint}
          hovered={hovered}
          onHover={setHovered}
        />
      </MapBoundary>
    </>
  );
}
