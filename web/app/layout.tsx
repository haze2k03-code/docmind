import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DocMind",
  description: "Ask questions about your company's documents and get cited answers.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
