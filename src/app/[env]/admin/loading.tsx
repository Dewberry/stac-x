import { PageLoading } from "@/components/page-loading";

/**
 * Admin while the catalogs are read (components/page-loading.tsx). After a
 * decision is saved the queue is rebuilt from every environment, so this is
 * the page that waits longest.
 */
export default function Loading() {
  return <PageLoading>Loading Admin…</PageLoading>;
}
