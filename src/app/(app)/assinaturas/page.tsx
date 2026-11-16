import { redirect } from "next/navigation";
import { AssinaturasTela } from "@/components/assinaturas/AssinaturasTela";
import { pode } from "@/lib/auth/permissoes";
import { BALCAO, sessaoAtual } from "@/lib/auth/sessao";
import { db } from "@/lib/db";

const idValido = (valor: unknown): valor is string => typeof valor === "string" && /^[a-zA-Z0-9_-]{1,40}$/.test(valor);

export default async function Assinaturas({ searchParams }: PageProps<"/assinaturas">) {
  const s = await sessaoAtual();
  if (!s || !BALCAO.includes(s.papel)) redirect("/");
  const { cliente, clienteId: clienteParam, assinatura } = await searchParams;
  const clienteId = idValido(clienteParam) ? clienteParam : undefined;
  const busca = typeof cliente === "string" ? cliente.trim().slice(0, 60) : "";
  const [podeCancelar, inicial] = await Promise.all([
    pode(s, "assinatura"),
    clienteId && idValido(assinatura)
      ? db.assinatura.findFirst({ where: { id: assinatura, clienteId }, select: { id: true } })
      : null,
  ]);
  return <AssinaturasTela key={JSON.stringify([clienteId, busca, inicial?.id])} podeCancelar={podeCancelar}
    clienteId={clienteId} buscaInicial={busca} assinaturaInicial={inicial?.id} />;
}
