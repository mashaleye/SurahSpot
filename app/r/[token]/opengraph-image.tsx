import { renderResultCardImage, RESULT_CARD_SIZE } from "@/lib/share/result-card-image";

export const runtime = "nodejs";
export const size = RESULT_CARD_SIZE;
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return renderResultCardImage(token);
}
