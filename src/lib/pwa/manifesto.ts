import type { MetadataRoute } from "next";

export function manifestoApp(area: "cliente" | "equipe"): MetadataRoute.Manifest {
  const cliente = area === "cliente";
  return {
    id: cliente ? "/c" : "/painel",
    name: cliente ? "Black Barber" : "Black Barber Equipe",
    short_name: cliente ? "Black Barber" : "Black Equipe",
    description: cliente ? "Sua agenda, planos e benefícios na Black Barber." : "Agenda, reuniões e rotina da equipe Black Barber.",
    start_url: cliente ? "/c" : "/painel",
    scope: "/",
    display: "standalone",
    lang: "pt-BR",
    background_color: "#08090b",
    theme_color: "#08090b",
    icons: [
      { src: "/pwa/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
