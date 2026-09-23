import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./studio.css";
import "./echo-premium.css";
import "./echo-rose.css";
import "./aero-theme.css";

export const metadata: Metadata = {
  title: "拾念 · 收好每一个念头",
  description: "记录一闪而过的想法，用自己的话理解，再在需要时找回来。七七的私人回声屿。",
  icons: { icon: "/icon.svg", apple: "/apple-touch-icon.png" },
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "拾念", statusBarStyle: "default" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#120f17" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
