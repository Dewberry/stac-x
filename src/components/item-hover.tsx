"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { FeatureCollection } from "geojson";
import { DataMap, type MapProps } from "./map";

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

type ChildPreview = { url: string; name: string; bbox: MapProps["bbox"] };
const ChildContext = createContext<{
  preview: ChildPreview | null;
  setPreview: (child: ChildPreview | null) => void;
}>({ preview: null, setPreview: () => {} });

export function ItemHoverProvider({ children }: { children: ReactNode }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [preview, setPreview] = useState<ChildPreview | null>(null);
  const value = useMemo(() => ({ hovered, setHovered }), [hovered]);
  const childValue = useMemo(() => ({ preview, setPreview }), [preview]);
  useEffect(() => {
    if (!preview) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreview(null);
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [preview]);
  return <Ctx.Provider value={value}><ChildContext.Provider value={childValue}>{children}</ChildContext.Provider></Ctx.Provider>;
}

/** Preview only while the child link is pointed at or keyboard-focused. */
export function ChildCollectionLink({ href, preview, children }: {
  href: string;
  preview: ChildPreview;
  children: ReactNode;
}) {
  const { setPreview } = useContext(ChildContext);
  useEffect(() => () => setPreview(null), [setPreview]);
  return (
    <Link href={href} className="sx-row"
      onMouseEnter={() => setPreview(preview)} onMouseLeave={() => setPreview(null)}
      onFocus={() => setPreview(preview)} onBlur={() => setPreview(null)}>
      {children}
    </Link>
  );
}

/** Outside a provider this is inert, so a list or map works alone too. */
export function useItemHover(): ItemHover {
  return useContext(Ctx);
}

/** The page map, joined to the list's hover. */
export function LinkedMap(props: Omit<MapProps, "hovered" | "onHover">) {
  const { hovered, setHovered } = useItemHover();
  const { preview } = useContext(ChildContext);
  const [loaded, setLoaded] = useState<Record<string, FeatureCollection | "error">>({});
  const pending = useRef(new Set<string>());
  useEffect(() => {
    if (!preview || loaded[preview.url] || pending.current.has(preview.url)) return;
    const { url, name } = preview;
    // A short pause avoids fetching every child when crossing a long list.
    const timer = setTimeout(() => {
      pending.current.add(url);
      fetch(url).then((r) => {
        if (!r.ok) throw new Error(r.statusText);
        return r.json() as Promise<FeatureCollection>;
      }).then((data) => {
        const features = data.features.map((feature, index) => ({
          ...feature,
          properties: {
            ...feature.properties,
            id: `child-preview-${index}`,
            label: name,
            kind: feature.properties?.role === "extent" ? "extent" : "feature",
          },
        }));
        setLoaded((previous) => ({ ...previous, [url]: { type: "FeatureCollection", features } }));
      }).catch(() => setLoaded((previous) => ({ ...previous, [url]: "error" })))
        .finally(() => pending.current.delete(url));
    }, 120);
    return () => clearTimeout(timer);
  }, [preview, loaded]);
  const data = preview ? loaded[preview.url] : null;
  const status = !preview ? "" : data === "error" ? `Couldn't preview ${preview.name}. Showing the collection's items.`
    : !data ? `Loading preview of ${preview.name}.` : `Previewing ${preview.name}.`;
  return <>
    <p className="sr-only" role="status">{status}</p>
    <DataMap {...props}
      {...(preview && data && data !== "error" ? {
        data, bbox: preview.bbox, label: `Preview of ${preview.name}`,
        hint: `Previewing ${preview.name}`, tip: undefined,
      } : {})}
      hovered={preview ? null : hovered} onHover={preview ? undefined : setHovered} />
  </>;
}
