import type { Metadata } from "next";
import { LayoutPreview } from "@/components/layout-preview";

export const metadata: Metadata = { title: "拾念 · 排版预览", robots: { index: false, follow: false } };
export default function Page() { return <LayoutPreview />; }
