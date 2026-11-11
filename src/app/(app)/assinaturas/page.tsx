import { redirect } from "next/navigation";
import { AssinaturasTela } from "@/components/assinaturas/AssinaturasTela";
import { pode } from "@/lib/auth/permissoes";
import { BALCAO, sessaoAtual } from "@/lib/auth/sessao";

export default async function Assinaturas({ searchParams }: { searchParams: Promise<{ cliente?: string | string[] }> }) {
  const s = (await sessaoAtual())!;
  if (!BALCAO.includes(s.papel)) redirect("/");
  const { cliente } = await searchParams;
  return <AssinaturasTela podeCancelar={await pode(s, "assinatura")} buscaInicial={typeof cliente === "string" ? cliente.slice(0, 160) : ""} />;
}
