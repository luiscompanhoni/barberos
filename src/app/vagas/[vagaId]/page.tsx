import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { camposPublicosVaga } from "@/lib/recrutamento/servico";
import { FormularioCandidatura } from "@/components/recrutamento/FormularioCandidatura";
export const dynamic = "force-dynamic";
export const metadata = { title: "Trabalhe na Black Barber", robots: { index: false, follow: false } };
export default async function Pagina({ params }: { params: Promise<{ vagaId: string }> }) {
  const vaga = await db.vagaRecrutamento.findFirst({ where: { id: (await params).vagaId, ativa: true }, select: camposPublicosVaga });
  if (!vaga) notFound();
  return <main className="mx-auto max-w-2xl px-4 py-8"><FormularioCandidatura vaga={vaga} /></main>;
}
