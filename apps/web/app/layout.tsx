import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@xyflow/react/dist/style.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "RepoVista — Codebase maps with evidence",
  description: "Understand any codebase as a map, not a maze.",
  metadataBase: new URL("http://localhost:3000"),
  openGraph: {
    title: "RepoVista — Codebase maps with evidence",
    description: "Interactive architecture maps and evidence-backed repository answers.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
