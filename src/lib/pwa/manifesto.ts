import type { MetadataRoute } from "next";

export function manifestoApp(area: "cliente" | "equipe" | "gestao"): MetadataRoute.Manifest {
  const cliente = area === "cliente";
  const gestao = area === "gestao";
  return {
    id: cliente ? "/c" : "/painel",
    name: gestao ? "BarberOS" : cliente ? "Black Barber" : "Black Barber Equipe",
    short_name: gestao ? "BarberOS" : cliente ? "Black Barber" : "Black Equipe",
    description: gestao ? "Gestão da barbearia no BarberOS." : cliente ? "Sua agenda, planos e benefícios na Black Barber." : "Agenda, reuniões e rotina da equipe Black Barber.",
    start_url: cliente ? "/c" : "/painel",
    scope: "/",
    display: "standalone",
    lang: "pt-BR",
    background_color: "#08090b",
    theme_color: "#08090b",
    icons: gestao ? [
      { src: "/pwa/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ] : [
      { src: "/brand/black/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/black/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
