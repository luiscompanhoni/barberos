import { notFound } from "next/navigation";
import { exigirSessao } from "@/lib/auth/sessao";
import { habilitado } from "@/lib/estudio/http";
import { EstudioTela } from "@/components/estudio/EstudioTela";
import { agentesHabilitados } from "@/lib/agentes/acesso";
export default async function EstudioPage({ searchParams }: { searchParams: Promise<{ roteiro?: string }> }) {
  const sessao = await exigirSessao();
  if (!habilitado()) notFound();
  const { roteiro } = await searchParams;
  return <EstudioTela podeImportar={sessao.papel === "DONO" && agentesHabilitados()} roteiroInicial={typeof roteiro === "string" && roteiro.length <= 40 ? roteiro : undefined} />;
}
