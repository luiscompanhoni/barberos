import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { FaixaAmbiente } from "@/components/FaixaAmbiente";
import "./globals.css";

// Design system BarberOS: uma grotesca geometrica (Manrope), pesos leves e numeros grandes.
// Arquivos oficiais versionados: o build não consulta Google Fonts (origens/licenças em docs/fontes-locais.md).
const manrope = localFont({ src: "./fonts/Manrope-Variable.ttf", variable: "--font-manrope", weight: "300 800", style: "normal", display: "swap" });
const geistMono = localFont({ src: "./fonts/GeistMono-Variable.woff2", variable: "--font-geist-mono", weight: "100 900", style: "normal", display: "swap" });

export const metadata: Metadata = {
  title: "Black Barber",
  description: "Agenda, atendimento e assinaturas da barbearia",
  manifest: "/manifest-cliente.webmanifest",
  appleWebApp: { capable: true, title: "Black Barber", statusBarStyle: "black" },
  icons: { icon: "/brand/black/icon-192.png", apple: "/brand/black/apple-touch-icon.png" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#090a0b" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={`${manrope.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <FaixaAmbiente />
        {children}
      </body>
    </html>
  );
}
