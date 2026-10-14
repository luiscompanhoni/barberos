import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { LandingCampanha } from "@/components/campanhas/LandingCampanha";
import { landingDaCampanha } from "@/lib/campanhas/link";

export const metadata: Metadata = { title: "Seu presente", robots: { index: false, follow: false } };

/** Link da campanha no WhatsApp (sem login): roleta de presente ou atalho para agendar. */
export default async function LinkCampanha({ params }: PageProps<"/c/r/[token]">) {
  await connection();
  const { token } = await params;
  const dados = /^[\w-]{10,40}$/.test(token) ? await landingDaCampanha(token) : null;
  if (!dados) notFound();
  return <LandingCampanha token={token} dados={dados} />;
}
