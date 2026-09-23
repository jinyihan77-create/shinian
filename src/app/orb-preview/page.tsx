import type { Metadata } from "next";
import { OrbPreview } from "@/components/orb-preview";

export const metadata: Metadata = { title: "拾念 · 幽光球质感预览", robots: { index: false, follow: false } };

export default function OrbPreviewPage() {
  return <OrbPreview />;
}
