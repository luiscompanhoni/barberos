import type { Metadata, Viewport } from "next";
import { Geist_Mono, Manrope } from "next/font/google";
import { FaixaAmbiente } from "@/components/FaixaAmbiente";
import "./globals.css";

// Design system BarberOS: uma grotesca geometrica (Manrope), pesos leves e numeros grandes.
const manrope = Manrope({ variable: "--font-manrope", subsets: ["latin"], weight: ["300", "400", "500", "600", "700", "800"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "BarberOS",
  description: "Agenda, atendimento e assinaturas da barbearia",
  manifest: "/manifest-cliente.webmanifest",
  appleWebApp: { capable: true, title: "Black Barber", statusBarStyle: "black" },
  icons: { icon: "/pwa/icon-192.png", apple: "/pwa/apple-touch-icon.png" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#08090b" };

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
