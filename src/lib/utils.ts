import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function collectionHref(id: string) {
  return `/collections/${encodeURIComponent(id)}`;
}

export function itemHref(collection: string, id: string) {
  return `/collections/${encodeURIComponent(collection)}/items/${encodeURIComponent(id)}`;
}

export function assetHref(href: string) {
  if (/^https?:\/\//i.test(href)) return href;
  return `/api/asset?href=${encodeURIComponent(href)}`;
}
