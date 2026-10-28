import { redirect } from "next/navigation";
import { permissoesDoUsuario } from "@/lib/auth/permissoes";
import { sessaoAtual } from "@/lib/auth/sessao";
import { ReunioesTela } from "@/components/reunioes/ReunioesTela";

export default async function ReunioesPage() {
  const s = await sessaoAtual();
  if (!s) redirect("/entrar");
  if (!["DONO", "GERENTE", "LIDER"].includes(s.papel) || !(await permissoesDoUsuario(s)).reunioes) redirect("/");
  return <ReunioesTela />;
}
