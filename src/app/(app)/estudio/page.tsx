import { notFound } from "next/navigation";
import { exigirSessao } from "@/lib/auth/sessao";
import { habilitado } from "@/lib/estudio/http";
import { EstudioTela } from "@/components/estudio/EstudioTela";
export default async function EstudioPage() {
  await exigirSessao();
  if (!habilitado()) notFound();
  return <EstudioTela />;
}
