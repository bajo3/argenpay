import type { Metadata, Viewport } from "next";
import { Cinzel, Geist, Geist_Mono } from "next/font/google";
import { Footer } from "@/components/footer";
import { Header } from "@/components/header";
import { ModeBanner } from "@/components/mode-banner";
import { MoneyProvider } from "@/components/money";
import { NavEffects } from "@/components/nav-effects";
import { Suspense } from "react";
import { getCurrency, getUsdRate } from "@/lib/fx";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const cinzel = Cinzel({ variable: "--font-cinzel", subsets: ["latin"], weight: ["500", "700", "800"] });

export const metadata: Metadata = {
  title: { default: "Argenpay · Mercado de Lineage 2 LU4", template: "%s · Argenpay LU4" },
  description: "Comprá y vendé adena, cuentas, ítems y servicios de Lineage 2 LU4 entre jugadores, en pesos argentinos.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#0a0910" };

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const [currency, rate] = await Promise.all([getCurrency(), getUsdRate().catch(() => null)]);
  return (
    <html lang="es-AR" className={`${geistSans.variable} ${geistMono.variable} ${cinzel.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <MoneyProvider initialCurrency={currency} rate={rate}>
        <ModeBanner />
        <Header />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:py-8">{children}</main>
        <Footer />
        <Suspense>
          <NavEffects />
        </Suspense>
        </MoneyProvider>
      </body>
    </html>
  );
}
