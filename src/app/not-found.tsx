import type { Metadata } from "next";
import { NotFoundCard } from "@/components/not-found-card";

export const metadata: Metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <div className="sx-page sx-msg">
      <div className="sx-msg-stage">
        <NotFoundCard />
      </div>
    </div>
  );
}
