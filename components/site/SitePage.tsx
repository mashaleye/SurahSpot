import type { ReactNode } from "react";
import { SiteHeader } from "./SiteHeader";
import { SiteFooter } from "./SiteFooter";

export function SitePage({ children }: { children: ReactNode }) {
  return (
    <div className="site-page-shell">
      <SiteHeader />
      <main className="content-main">{children}</main>
      <SiteFooter />
    </div>
  );
}
