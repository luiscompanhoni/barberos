"use client";
import { usePathname } from "next/navigation";
import { SinoNotificacoes } from "@/components/notificacoes/SinoNotificacoes";
import { rotaAtiva, type LinkNavegacao } from "./estrutura";
export function TopoWorkspace({ links, nome }: { links: LinkNavegacao[]; nome: string }) {
  const path = usePathname();
  const atual = links.filter(l => rotaAtiva(path, l.href)).sort((a, b) => b.href.length - a.href.length)[0];
  return <header className="black-workspace-topbar"><p><span>Seu espaço</span><span aria-hidden="true">/</span><strong>{atual?.rotulo ?? "Minha conta"}</strong></p>
    <div className="flex items-center gap-3"><span className="text-xs text-zinc-600">{nome.split(" ")[0]}</span><SinoNotificacoes href="/notificacoes" area="equipe" /></div>
  </header>;
}
