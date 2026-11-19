import type { Metadata } from "next";
import { tokenDeConvite } from "@/lib/convites/link";
import { VisitaConvite } from "@/components/convites/VisitaConvite";
import { urlSite } from "@/lib/dominios";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { LandingCampanha } from "@/components/campanhas/LandingCampanha";
import { landingDaCampanha } from "@/lib/campanhas/link";

export async function generateMetadata({ params }: PageProps<"/c/r/[token]">): Promise<Metadata> {
  const robots = { index: false, follow: false };
  if (!tokenDeConvite((await params).token)) return { title: "Seu presente", robots };
  return { title: "App da Black Barber", robots, openGraph: { title: "App da Black Barber",
    description: "Escolha seu barbeiro e peça seu próximo horário pelo celular.",
    images: [{ url: urlSite() + "/brand/black/previa-app-v1.png", width: 1200, height: 630, type: "image/png", alt: "Black Barber" }] } };
}

/** Link da campanha no WhatsApp (sem login): roleta de presente ou atalho para agendar. */
export default async function LinkCampanha({ params }: PageProps<"/c/r/[token]">) {
  await connection();
  const { token } = await params;
  if (tokenDeConvite(token)) return <main className="mx-auto max-w-md p-6"><VisitaConvite etapa="clique" token={token} />
    <h1 className="text-xl font-bold">App da Black Barber</h1><p className="mt-2">Abrindo a agenda…</p>
    <a className="btn-primario mt-4" href="/c/agendar">Abrir a agenda</a></main>;
  const dados = /^[\w-]{10,40}$/.test(token) ? await landingDaCampanha(token) : null;
  if (!dados) notFound();
  return <LandingCampanha token={token} dados={dados} />;
}
