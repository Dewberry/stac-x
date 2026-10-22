"use client";

import { usePathname } from "next/navigation";
import { ErrorCard } from "@/components/error-card";
import { splitEnv, withEnv } from "@/lib/env";
import { withBase } from "@/lib/utils";

/** A page that threw. The header and footer are still there; only the page is replaced. */
export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  const { env } = splitEnv(usePathname());
  return (
    <div className="sx-page sx-msg">
      <title>Something went wrong</title>
      <div className="sx-msg-stage">
        <ErrorCard error={error} retry={retry} home={withBase(withEnv(env, "/"))} />
      </div>
    </div>
  );
}
