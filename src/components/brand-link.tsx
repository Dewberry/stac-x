"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { splitEnv, withEnv } from "@/lib/env";

/** The wordmark, linking to the home page of the environment you're in. */
export function BrandLink({ className }: { className: string }) {
  const pathname = usePathname();
  const href = pathname === "/signin" ? "/signin" : withEnv(splitEnv(pathname).env, "/");
  return (
    <Link href={href} className={className}>
      stac-x
    </Link>
  );
}
