"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Ellipsis, LogOut, X } from "lucide-react";
import { Marca } from "./Marca";
import { SinoNotificacoes } from "./notificacoes/SinoNotificacoes";
import { agruparLinks, atalhosMobile, rotaAtiva, type LinkNavegacao } from "./navegacao/estrutura";
import { iconeDaRota, iconeDoGrupo } from "./navegacao/icones";
import { desativarPushLocal } from "@/lib/pwa/push-cliente";

const PAPEIS: Record<string, string> = { DONO: "Dono", GERENTE: "Gerente", LIDER: "Líder de equipe", RECEPCAO: "Recepção", BARBEIRO: "Barbeiro" };
const iniciais = (nome: string) => nome.trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() ?? "").join("");

export function Navegacao({ nome, papel, links, nomeBarbearia, selos = {} }: {
  nome: string; papel: string; links: LinkNavegacao[]; nomeBarbearia: string; selos?: Record<string, number>;
}) {
  const path = usePathname();
  const router = useRouter();
  const [mais, setMais] = useState(false);
  const [erro, setErro] = useState("");
  const dialogo = useRef<HTMLDialogElement>(null);
  const grupos = agruparLinks(links);
  const atalhos = atalhosMobile(links);

  useEffect(() => {
    const d = dialogo.current;
    if (!mais || !d) return;
    d.showModal();
    const desktop = window.matchMedia("(min-width: 1024px)");
    const fecharNoDesktop = () => { if (desktop.matches) d.close(); };
    desktop.addEventListener("change", fecharNoDesktop);
    return () => { desktop.removeEventListener("change", fecharNoDesktop); if (d.open) d.close(); };
  }, [mais]);

  async function sair() {
    setErro("");
    try {
      const resposta = await fetch("/api/auth/sair", { method: "POST" });
      if (!resposta.ok) throw new Error();
      await desativarPushLocal({ servidor: false }).catch(() => {});
      router.replace("/entrar"); router.refresh();
    } catch { setErro("Não foi possível sair. Tente novamente."); }
  }

  const item = (l: LinkNavegacao) => {
    const Icone = iconeDaRota(l.href);
    return <Link key={l.href} href={l.href} onClick={() => setMais(false)} className="black-nav-item" aria-current={rotaAtiva(path, l.href) ? "page" : undefined}>
      <Icone size={19} strokeWidth={1.65} aria-hidden="true" /><span>{l.rotulo}</span>
      {!!selos[l.href] && <span className="black-nav-count" aria-label={`${selos[l.href]} pendências`}>{selos[l.href]}</span>}
    </Link>;
  };

  const menu = (mobile = false) => grupos.map(g => {
    const temAtivo = g.itens.some(l => rotaAtiva(path, l.href));
    const Icone = iconeDoGrupo(g.titulo);
    const pendencias = g.itens.reduce((n, l) => n + (selos[l.href] ?? 0), 0);
    return g.agrupado && !mobile ? <details key={`${g.titulo}:${path}`} className="black-nav-disclosure" open={temAtivo}>
      <summary className="black-nav-item"><Icone size={19} strokeWidth={1.65} aria-hidden="true" /><span>{g.titulo}</span>
        {!!pendencias && <span className="black-nav-count">{pendencias}</span>}<ChevronDown size={14} className="black-disclosure-arrow" aria-hidden="true" />
      </summary><div className="black-nav-children">{g.itens.map(item)}</div>
    </details> : <section key={g.titulo} className="black-nav-group" aria-label={g.titulo}>
      <p>{g.titulo}</p><div>{g.itens.map(item)}</div>
    </section>;
  });

  const perfil = <div className="black-profile"><span className="black-avatar" aria-hidden="true">{iniciais(nome)}</span>
    <Link href="/conta" onClick={() => setMais(false)} className="min-w-0 flex-1"><strong className="block truncate">{nome}</strong><span>{PAPEIS[papel] ?? papel} · minha conta</span></Link>
    <button className="black-icon-button" onClick={sair} aria-label="Sair da conta"><LogOut size={18} aria-hidden="true" /></button>
  </div>;

  return <>
    <a href="#conteudo-principal" className="black-skip-link">Pular para o conteúdo</a>
    <aside className="black-sidebar">
      <div className="black-sidebar-brand"><Marca nome={nomeBarbearia} /></div>
      <div className="black-sidebar-caption"><span className="black-status-dot" />Seu espaço na Black</div>
      <nav aria-label="Menu principal" className="black-sidebar-nav">{menu()}</nav>
      {perfil}
    </aside>
    <header className="black-mobile-header"><Marca nome={nomeBarbearia} /><SinoNotificacoes href="/notificacoes" area="equipe" /></header>
    <nav className="black-bottom-nav" aria-label="Menu do celular">
      {atalhos.map(l => { const Icone = iconeDaRota(l.href); return <Link key={l.href} href={l.href} aria-current={rotaAtiva(path, l.href) ? "page" : undefined}>
        <Icone size={20} strokeWidth={1.65} aria-hidden="true" /><span>{l === atalhos[0] ? "Início" : l.href.includes("agenda") || l.href === "/recepcao" || l.href === "/semana" ? "Agenda" : l.rotulo}</span>
      </Link>; })}
      <button onClick={() => setMais(true)} aria-expanded={mais} aria-haspopup="dialog" aria-controls="black-menu-mais">
        <Ellipsis size={21} aria-hidden="true" /><span>Mais</span>
        {links.some(l => selos[l.href] && !atalhos.includes(l)) && <span className="black-menu-pending" aria-label="Há pendências em outras áreas" />}
      </button>
    </nav>
    <dialog ref={dialogo} id="black-menu-mais" className="black-more-dialog" aria-labelledby="black-menu-titulo" onClose={() => setMais(false)} onClick={e => { if (e.target === e.currentTarget) setMais(false); }}>
      <div className="black-more-header"><div><p className="eyebrow">Tudo em seu lugar</p><h2 id="black-menu-titulo">Explorar a Black</h2></div><button className="black-icon-button" onClick={() => setMais(false)} aria-label="Fechar menu"><X size={21} aria-hidden="true" /></button></div>
      <nav aria-label="Todas as áreas">{menu(true)}</nav>{perfil}
    </dialog>
    {erro && <p role="alert" className="black-nav-error">{erro}</p>}
  </>;
}
