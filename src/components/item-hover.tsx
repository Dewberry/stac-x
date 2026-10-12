"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { DataMap, type MapProps } from "./map";

/**
 * One shared "item pointed at" for a page whose map and list show the same
 * items. The collection page's two models of one basin draw as one shape,
 * so pointing at a row is how you see which shape is which, and pointing at
 * the map finds the row.
 */

type ItemHover = { hovered: string | null; setHovered: (id: string | null) => void };

const Ctx = createContext<ItemHover>({ hovered: null, setHovered: () => {} });

export function ItemHoverProvider({ children }: { children: ReactNode }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const value = useMemo(() => ({ hovered, setHovered }), [hovered]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Outside a provider this is inert, so a list or map works alone too. */
export function useItemHover(): ItemHover {
  return useContext(Ctx);
}

/** The page map, joined to the list's hover. */
export function LinkedMap(props: Omit<MapProps, "hovered" | "onHover">) {
  const { hovered, setHovered } = useItemHover();
  return <DataMap {...props} hovered={hovered} onHover={setHovered} />;
}
