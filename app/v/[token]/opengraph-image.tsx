import { renderVerseCardImage, VERSE_CARD_SIZE } from "@/lib/share/verse-card-image";

export const runtime = "nodejs";
export const size = VERSE_CARD_SIZE;
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return renderVerseCardImage(token);
}
