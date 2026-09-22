import type { Metadata } from "next";
import { DesignPreview } from "@/components/design-preview";

export const metadata: Metadata = { title: "拾念 · 界面预览", robots: { index: false, follow: false } };
export default function DesignPreviewPage() { return <DesignPreview />; }
