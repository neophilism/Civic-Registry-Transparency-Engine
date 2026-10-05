import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Civic Registry & Transparency Engine",
  description:
    "Reusable civic infrastructure for searchable public registries and transparency workflows.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
