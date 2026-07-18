import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "轻选 Agent",
  description: "跨境电商选品与运营辅助工作台。系统整理证据、生成建议并提示风险，关键动作由人工确认。",
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
