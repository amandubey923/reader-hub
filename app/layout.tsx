import "./globals.css";
import type { Metadata, Viewport } from "next";
import { ReactNode } from "react";
import { AuthProvider } from "@/context/AuthContext";
import { EntitlementProvider } from "@/context/EntitlementContext";
import { LibraryProvider } from "@/context/LibraryContext";
import { ThemeProvider } from "@/components/visual/ThemeProvider";
import CustomCursor from "@/components/visual/CustomCursor";
import AmbientEffects from "@/components/visual/AmbientEffects";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import GlobalModals from "@/components/GlobalModals";

import Script from "next/script";

export const viewport: Viewport = {
  themeColor: "#0b0d13",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export const metadata: Metadata = {
  title: {
    default: "Reader's HUB — Explore & Read Books",
    template: "%s | Reader's HUB",
  },
  description:
    "A modern, fast, and completely free public digital reading library. Explore world classics, Hindi literature, philosophy, and stories with zero login barriers.",
  keywords: [
    "Reader's HUB",
    "Digital Library",
    "Read Books Online",
    "Free PDFs",
    "Hindi Literature",
    "Premchand Godan",
    "Madhushala",
    "1984 George Orwell",
    "Great Gatsby",
    "War and Peace",
    "Classical Books",
    "Online Book Reader"
  ],
  authors: [{ name: "Reader's HUB Team" }],
  creator: "Reader's HUB",
  publisher: "Reader's HUB",
  metadataBase: new URL("https://readershub.app"),
  openGraph: {
    title: "Reader's HUB — Explore & Read Books",
    description:
      "A fast, distraction-free digital library for literature lovers. Read classic books, Hindi masterpieces, and philosophy instantly.",
    siteName: "Reader's HUB",
    locale: "en_US",
    type: "website",
    images: [
      {
        url: "/images/login.jpg",
        width: 1200,
        height: 630,
        alt: "Reader's HUB - Digital Reading Library",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Reader's HUB — Explore & Read Books",
    description:
      "A fast, distraction-free digital library for literature lovers. Read classic books, Hindi masterpieces, and philosophy instantly.",
    images: ["/images/login.jpg"],
  },
  icons: {
    icon: [
      { url: "/images/logo.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  manifest: "/manifest.json",
  applicationName: "Reader's HUB",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Reader's HUB",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en" data-theme="architect" className="scroll-smooth" suppressHydrationWarning>
      <head>
        <script
          async={true}
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('readers_hub_theme_v3')||localStorage.getItem('readers_hub_theme_v2')||localStorage.getItem('readers_hub_theme')||'architect';document.documentElement.setAttribute('data-theme',t);}catch(e){}if('serviceWorker' in navigator && window.location.protocol.startsWith('http')){navigator.serviceWorker.register('/sw.js').catch(function(e){console.warn('[PWA] SW registration notice:',e);});}window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__pwaInstallPrompt=e;window.dispatchEvent(new Event('pwa-prompt-available'));});window.addEventListener('appinstalled',function(){window.__pwaInstallPrompt=null;window.dispatchEvent(new Event('pwa-installed'));});})();`,
          }}
        />
      </head>
      <body className="min-h-screen flex flex-col bg-[var(--background)] text-[var(--foreground)] selection:bg-[var(--primary)] selection:text-[var(--primary-foreground)] relative">
        <ThemeProvider>
          <AuthProvider>
            <EntitlementProvider>
              <LibraryProvider>
                <AmbientEffects />
                <CustomCursor />
                <Navbar />
                <div className="flex-1 flex flex-col pt-16 relative z-10">
                  {children}
                </div>
                <Footer />
                <GlobalModals />
              </LibraryProvider>
            </EntitlementProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}