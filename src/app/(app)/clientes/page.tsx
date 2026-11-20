import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ClientesTela } from "@/components/clientes/ClientesTela";
import { BALCAO, sessaoAtual } from "@/lib/auth/sessao";

export default async function Clientes() {
  const sessao = await sessaoAtual();
  if (!sessao) redirect("/entrar");
  if (sessao.papel === "CLIENTE") redirect("/c");
  if (!BALCAO.includes(sessao.papel)) redirect("/");
  return <Suspense fallback={<p role="status">Carregando clientes…</p>}><ClientesTela /></Suspense>;
}
