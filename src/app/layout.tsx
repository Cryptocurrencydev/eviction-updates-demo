import type { Metadata, Viewport } from "next";
import { Source_Sans_3, Source_Serif_4 } from "next/font/google";
import { Footer } from "@/components/Footer";
import "./globals.css";

const body = Source_Sans_3({ subsets: ["latin"], variable: "--font-body" });
const head = Source_Serif_4({ subsets: ["latin"], variable: "--font-head" });

export const metadata: Metadata = {
  title: "Docketlight",
  description: "Keeps property owners updated by text while your firm runs their eviction cases. Fictional demo.",
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#451436" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${body.variable} ${head.variable}`}>
      <body className="flex min-h-dvh flex-col font-sans antialiased">
        {children}
        <Footer />
      </body>
    </html>
  );
}
