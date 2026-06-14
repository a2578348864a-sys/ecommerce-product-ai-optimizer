import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "轻选 Agent",
  description: "小红书无货源选品助手，先拆素材证据，再看风险和小白结论。",
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
