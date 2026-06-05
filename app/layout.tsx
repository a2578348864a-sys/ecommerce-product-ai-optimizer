import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "阿里国际站选品发布 AI 助手 Pro",
  description: "输入产品信息，AI 帮你初步判断产品机会、利润风险、物流风险、认证风险、B2B 适配度，并生成阿里国际站标题、关键词、详情页和询盘回复。",
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