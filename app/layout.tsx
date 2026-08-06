import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "轻选工作台｜AI 跨境商品研究工作台",
  description: "从发现商品、商品研究到 Listing 和图片草稿，用 AI 整理信息和辅助创作，由人工完成最终决定。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
