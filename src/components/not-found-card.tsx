"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageCard, MessageRow } from "./message-card";
import { splitEnv, withEnv } from "@/lib/env";
import { collectionHref } from "@/lib/utils";

/**
 * The 404 card. It reads the address, so it says what was asked for: an
 * item a collection doesn't have gets the collection to go to, anything
 * else gets the address it couldn't find and the way back to the map.
 */
export function NotFoundCard() {
  const pathname = usePathname();
  const { env, rest } = splitEnv(pathname);
  const home = withEnv(env, "/");
  const item = /^\/collections\/([^/]+)\/items\/([^/]+)\/?$/.exec(rest);

  if (item) {
    const [collection, id] = item.slice(1).map(decode);
    return (
      <MessageCard
        mark="missing"
        kicker="404"
        title="Item not found"
        aside={
          <MessageRow
            href={collectionHref(env, collection)}
            title={collection}
            sub="Open the collection and see the items it has"
          />
        }
        actions={
          <Link href={home} className="ffx-btn">
            Back to the map
          </Link>
        }
      >
        <p>
          <code className="ffx-id">{id}</code> isn&apos;t one of the items in this collection. It may have been renamed, or left out the
          last time the collection was built.
        </p>
      </MessageCard>
    );
  }

  return (
    <MessageCard
      mark="missing"
      kicker="404"
      title="Page not found"
      actions={
        <>
          <Link href={home} className="ffx-btn ffx-btn-primary">
            Back to the map
          </Link>
          <button type="button" className="ffx-btn" onClick={() => history.back()}>
            Go back
          </button>
        </>
      }
    >
      <p>
        Nothing in the catalog is at <code className="ffx-id">{pathname}</code>. The link may be out of date, or the
        address may have a typo in it.
      </p>
    </MessageCard>
  );
}

/** A path segment as it was typed, or as it came if it won't decode. */
function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
