import type { Metadata } from "next";
import { ehJornadaComRoleta, enderecoDoConvite, previaConvite, previaDaRoleta, tokenDeConvite } from "@/lib/convites/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { LandingCampanha } from "@/components/campanhas/LandingCampanha";
import { landingDaCampanha, roletaComEnvioReservado } from "@/lib/campanhas/link";

export async function generateMetadata({ params }: PageProps<"/c/r/[token]">): Promise<Metadata> {
  const robots = { index: false, follow: false };
  const { token } = await params;
  if (!tokenDeConvite(token)) return { title: "Seu presente", robots };
  if (ehJornadaComRoleta(token)) return previaDaRoleta(token);
  return previaConvite(token);
}

/** Link da campanha no WhatsApp (sem login): roleta de presente ou atalho para agendar. */
export default async function LinkCampanha({ params }: PageProps<"/c/r/[token]">) {
  await connection();
  const { token } = await params;
  if (tokenDeConvite(token) && !ehJornadaComRoleta(token)) redirect(enderecoDoConvite(token));
  const dados = /^[\w-]{10,40}$/.test(token) ? await landingDaCampanha(token) : null;
  if (!dados && ehJornadaComRoleta(token) && await roletaComEnvioReservado(token)) {
    return <main className="mx-auto max-w-xl px-5 py-16 text-center">
      <h1 className="titulo-marca text-3xl">Roleta da Black</h1>
      <p className="mt-4">Teu convite está sendo preparado. Abre o link de novo em instantes.</p>
    </main>;
  }
  if (!dados) notFound();
  return <LandingCampanha token={token} dados={dados} />;
}
