"use client";

import { useEffect } from "react";
import { MessageCard } from "./message-card";

/**
 * What a page shows when it throws. Almost always it's the catalog: S3 or
 * the parquet read timed out or was refused, and trying again works. In
 * production the message is hidden, so the card gives the digest instead,
 * which matches the server log line, for whoever looks into it.
 */
export function ErrorCard({ error, retry, home }: { error: unknown; retry: () => void; home: string }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const digest = error instanceof Error && "digest" in error && typeof error.digest === "string" ? error.digest : null;

  return (
    <MessageCard
      mark="error"
      kicker="Something went wrong"
      title="This page couldn't load"
      actions={
        <>
          <button type="button" className="ffx-btn ffx-btn-primary" onClick={() => retry()}>
            Try again
          </button>
          {/* A plain link, not next/link: the app around this card may be the thing that broke. */}
          <a href={home} className="ffx-btn">
            Back to the map
          </a>
        </>
      }
    >
      <p>
        Something failed while this page was loading. It&apos;s usually a slow or dropped read from the catalog&apos;s
        storage, so trying again tends to work. If it keeps happening, send the reference below to whoever runs this
        catalog.
      </p>
      {digest && (
        <p className="sx-msg-ref">
          Reference <code className="ffx-id">{digest}</code>
        </p>
      )}
    </MessageCard>
  );
}
