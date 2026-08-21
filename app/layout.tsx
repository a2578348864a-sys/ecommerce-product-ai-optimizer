import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "轻选工作台｜AI 跨境商品研究与上架准备工作台",
  description: "基于证据链、产品事实闸门和人工决策的 AI 跨境商品研究与上架准备工作台：AI 完成研究与资料整理，人做关键商业决策。",
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
