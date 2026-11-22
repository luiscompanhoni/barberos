import type { Metadata } from "next";
import { ehJornadaComRoleta, enderecoDoConvite, previaConvite, tokenDeConvite } from "@/lib/convites/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { LandingCampanha } from "@/components/campanhas/LandingCampanha";
import { landingDaCampanha } from "@/lib/campanhas/link";

export async function generateMetadata({ params }: PageProps<"/c/r/[token]">): Promise<Metadata> {
  const robots = { index: false, follow: false };
  const { token } = await params;
  if (!tokenDeConvite(token) || ehJornadaComRoleta(token)) return { title: "Seu presente", robots };
  return previaConvite(token);
}

/** Link da campanha no WhatsApp (sem login): roleta de presente ou atalho para agendar. */
export default async function LinkCampanha({ params }: PageProps<"/c/r/[token]">) {
  await connection();
  const { token } = await params;
  if (tokenDeConvite(token) && !ehJornadaComRoleta(token)) redirect(enderecoDoConvite(token));
  const dados = /^[\w-]{10,40}$/.test(token) ? await landingDaCampanha(token) : null;
  if (!dados) notFound();
  return <LandingCampanha token={token} dados={dados} />;
}
