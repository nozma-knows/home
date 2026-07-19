import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { PwaRegister } from "@/components/pwa-register";

import "./globals.css";

const geist = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "home",
  description: "Your work, context, and AI agents in one calm place.",
  applicationName: "home",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "home" },
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body className={`${geist.variable} ${geistMono.variable}`}>
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
