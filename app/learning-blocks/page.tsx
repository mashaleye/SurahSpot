import type { Metadata } from "next";
import { LearningBlocksReader } from "@/components/learning/LearningBlocksReader";

export const metadata: Metadata = {
  alternates: { canonical: "/learning-blocks" },
  title: "Learning Blocks — SurahSpot",
  description:
    "Read the Qur’an page by page, hide Ayahs for recall practice, and rebuild hidden blocks in sequence at your own pace.",
};

export default function LearningBlocksPage() {
  return <LearningBlocksReader />;
}
