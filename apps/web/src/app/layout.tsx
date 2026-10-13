import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "react-day-picker/dist/style.css";
import "../styles/antd.css";
import "../styles/print.css";
import { Providers } from "./providers";
import ChunkErrorBoundary from "../components/ChunkErrorBoundary";

/**
 * Inter est servie depuis le dépôt plutôt que depuis `next/font/google` : ce
 * dernier télécharge le fichier depuis fonts.gstatic.com **à la compilation**,
 * et une coupure réseau y fait échouer le build entier.
 *
 * Le fichier est la police variable (100→900) du sous-ensemble `latin`, soit
 * exactement la couverture de l'ancienne configuration `subsets: ["latin"]`.
 * Pour couvrir davantage de glyphes (latin-ext), télécharger le woff2
 * correspondant sur fonts.googleapis.com et l'ajouter à `src`.
 */
const inter = localFont({
  src: "./fonts/inter-latin-variable.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  variable: "--font-inter",
  // Repli aligné sur celui que générait next/font/google, pour limiter le
  // décalage de mise en page pendant le chargement.
  fallback: ["system-ui", "Segoe UI", "Helvetica Neue", "Arial", "sans-serif"],
});

export const metadata: Metadata = {
  title: "EcoleDigitale",
  description: "Plateforme éducative numérique multi-tenant",
  // PWA : manifeste et icônes (public/manifest.webmanifest, public/icons) ; service worker : public/sw.js.
  manifest: "/manifest.webmanifest",
  applicationName: "EcoleDigitale",
  appleWebApp: { capable: true, title: "EcoleDigitale", statusBarStyle: "default" },
  icons: {
    icon: [
      { url: "/icons/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#2563eb",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr" suppressHydrationWarning className="h-full overflow-hidden">
      <body className={`${inter.className} bg-background text-foreground antialiased overflow-x-hidden h-full overflow-y-hidden`} suppressHydrationWarning>
        <ChunkErrorBoundary>
          <Providers>{children}</Providers>
        </ChunkErrorBoundary>
      </body>
    </html>
  );
}

