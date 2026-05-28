import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "电商商品页 AI 优化器",
  description: "输入商品信息，一键生成标题、详情页、短视频脚本、客服话术和差评回复。",
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
