import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import "react-day-picker/dist/style.css";
import "../styles/antd.css";
import "../styles/print.css";
// Patch de compatibilité Ant Design pour React 19 (supprime l'avertissement de compatibilité)
import "@ant-design/v5-patch-for-react-19";
import { Providers } from "./providers";
import "../lib/fetch-interceptor";
import ChunkErrorBoundary from "../components/ChunkErrorBoundary";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "EcoleDigitale",
  description: "Plateforme éducative numérique multi-tenant",
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

