import type { Metadata } from "next";
import { Manrope, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { Footer } from "@/components/shared/Footer";
import { Navbar } from "@/components/shared/Navbar";

const bodyFont = Manrope({
  subsets: ["latin"],
  variable: "--font-body",
});

const displayFont = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
});

export const metadata: Metadata = {
  title: {
    default: "Formation Pro | Développez vos compétences",
    template: "%s | Formation Pro",
  },
  description:
    "Découvrez notre catalogue de formations professionnelles certifiantes, finançables et accessibles en ligne.",
  openGraph: {
    type: "website",
    locale: "fr_FR",
    siteName: "Formation Pro",
    title: "Formation Pro",
    description:
      "Catalogue public de formation professionnelle avec inscription et paiement en ligne.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body className={`${bodyFont.variable} ${displayFont.variable} font-sans`}>
        <Providers>
          <div className="relative min-h-screen overflow-x-hidden">
            <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[32rem] bg-[radial-gradient(circle_at_top,_rgba(239,114,61,0.22),_transparent_50%)]" />
            <Navbar />
            <main>{children}</main>
            <Footer />
          </div>
        </Providers>
      </body>
    </html>
  );
}
