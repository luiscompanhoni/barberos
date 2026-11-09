import { exigirSessao } from "@/lib/auth/sessao";
import { MeuDiaTela } from "@/components/reunioes/MeuDiaTela";
import Link from "next/link";

export default async function MeuDiaPage() {
  await exigirSessao();
  return <><nav className="crm-subtabs mb-4 flex flex-wrap gap-2" aria-label="Visualização da agenda"><Link href="/recepcao">Agenda</Link><Link href="/meu-dia" aria-current="page">Meu dia</Link><Link href="/semana">Semana</Link></nav><MeuDiaTela /></>;
}
