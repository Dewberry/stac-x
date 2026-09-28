import type { Metadata } from "next";
import { catalogTitle } from "@/lib/config";
import { envMeta } from "@/lib/env";
import { pageEnv } from "@/lib/page-env";

/** Outside Production, every tab title starts with the environment, so a row of tabs says which is which. */
export async function generateMetadata({ params }: LayoutProps<"/[env]">): Promise<Metadata> {
  const env = await pageEnv(params);
  if (env === "prod") return {};
  const tag = `[${envMeta(env).short}]`;
  return { title: { absolute: `${tag} ${catalogTitle}`, template: `${tag} %s | ${catalogTitle}` } };
}

export default async function EnvLayout({ children, params }: LayoutProps<"/[env]">) {
  await pageEnv(params);
  return <>{children}</>;
}
