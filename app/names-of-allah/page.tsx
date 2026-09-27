import type { Metadata } from "next";

import { SitePage } from "@/components/site/SitePage";
import { NamesExplorer } from "@/components/site/NamesExplorer";
import { NamesHero } from "@/components/site/NamesHero";

export const metadata: Metadata = {
  alternates: { canonical: "/names-of-allah" },
  title: "99 Names of Allah — SurahSpot",
  description:
    "Explore the 99 Names of Allah with Arabic, transliteration, concise meanings, search, and supported project languages.",
};

export default function NamesOfAllahPage() {
  return (
    <SitePage>
      <NamesHero />

      <NamesExplorer />
    </SitePage>
  );
}