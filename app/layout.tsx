import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "轻选 Agent",
  description: "跨境电商运营全流程 Agent 工作台 Alpha MVP。AI 给建议、生成资料、提示风险，关键动作人工确认，未来逐步走向受控自动化。当前不会自动采购、上架或投广告。",
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
