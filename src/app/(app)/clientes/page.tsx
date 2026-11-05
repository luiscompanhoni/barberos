import { Suspense } from "react";
import { ClientesTela } from "@/components/clientes/ClientesTela";
import { BALCAO, exigirSessao } from "@/lib/auth/sessao";

export default async function Clientes() {
  await exigirSessao(BALCAO);
  return <Suspense fallback={<p role="status">Carregando clientes…</p>}><ClientesTela /></Suspense>;
}
