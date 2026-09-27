import { renderVerseCardImage } from "@/lib/share/verse-card-image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stable PNG endpoint used by the in-app custom share sheet. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  return renderVerseCardImage(token);
}
