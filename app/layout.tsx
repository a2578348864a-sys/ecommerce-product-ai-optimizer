import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "轻选 Agent",
  description: "面向跨境电商新手和小团队的全自动电商 Agent，当前 Alpha MVP 通过受控自动化和人工复核判断商品机会与风险。",
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
