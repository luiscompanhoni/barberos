"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  BarChart3, BriefcaseBusiness, CalendarDays, ChartLine, CalendarRange, ClipboardCheck, Clock3, CreditCard, Dices, Landmark, LayoutDashboard, LogOut, Megaphone, Menu,
  MessageSquareText, Package, PanelLeft, Receipt, Settings, ShieldCheck, Smartphone, UserRound, X, type LucideIcon,
} from "lucide-react";
import { Marca } from "./Marca";

const PAPEIS: Record<string, string> = { DONO: "Dono", GERENTE: "Gerente", RECEPCAO: "Recepção", BARBEIRO: "Barbeiro" };

const ICONES: Record<string, LucideIcon> = {
  "/painel": LayoutDashboard,
  "/recepcao": PanelLeft,
  "/semana": CalendarRange,
  "/conversas": MessageSquareText,
  "/assinaturas": CreditCard,
  "/planos": BarChart3,
  "/expediente": Clock3,
  "/equipe": Settings,
  "/simulador": Smartphone,
  "/minha-agenda": CalendarDays,
  "/comandas": Receipt,
  "/estoque": Package,
  "/indicadores": ChartLine,
  "/jogos": Dices,
  "/financeiro": Landmark,
  "/caixa": Receipt,
  "/checklist": ClipboardCheck,
  "/rh": BriefcaseBusiness,
  "/recrutamento": BriefcaseBusiness,
  "/whatsapp": Smartphone,
  "/auditoria": ShieldCheck,
  "/cultura-black": ShieldCheck,
  "/campanhas": Megaphone,
  "/campanhas-equipe": Dices,
  "/meu-financeiro": Landmark,
};

const iniciais = (nome: string) =>
  nome.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");

/** Menu da equipe: barra lateral no computador, barra inferior no celular. */
export function Navegacao({
  nome,
  papel,
  links,
  nomeBarbearia,
  selos = {},
}: {
  nome: string;
  papel: string;
  nomeBarbearia: string;
  links: { href: string; rotulo: string }[];
  /** Contador de pendencias por link (ex.: estornos esperando o dono). */
  selos?: Record<string, number>;
}) {
  const path = usePathname();
  const router = useRouter();
  const [mais, setMais] = useState(false);
  const ativo = (href: string) => path.startsWith(href);

  async function sair() {
    await fetch("/api/auth/sair", { method: "POST" });
    router.replace("/entrar");
    router.refresh();
  }

  const item = (l: { href: string; rotulo: string }) => {
    const Icone = ICONES[l.href] ?? (l.href.startsWith("/indicadores") ? ChartLine : UserRound);
    return (
      <Link
        key={l.href}
        href={l.href}
        onClick={() => setMais(false)}
        className="black-nav-item"
        aria-current={ativo(l.href) ? "page" : undefined}
      >
        <Icone size={17} strokeWidth={1.6} />
        {l.rotulo}
        {!!selos[l.href] && <span className="ml-auto rounded-full bg-ouro px-1.5 text-[11px] font-semibold text-[#1b1406]" title="Pendências">{selos[l.href]}</span>}
      </Link>
    );
  };

  const rodapeUsuario = (
    <div className="black-painel flex items-center gap-3 px-3.5 py-3">
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-ouro/40 bg-[linear-gradient(180deg,rgb(211_171_69/22%),rgb(24_23_20/60%))] text-xs font-semibold text-ouro-claro shadow-[inset_0_1px_0_rgb(255_244_195/14%)]">{iniciais(nome)}</div>
      <Link href="/conta" className="min-w-0 flex-1 hover:text-ouro" title="Minha conta e senha">
        <p className="truncate text-sm font-semibold">{nome}</p>
        <p className="text-xs text-zinc-500">{PAPEIS[papel] ?? papel} · minha conta</p>
      </Link>
      <button onClick={sair} title="Sair" aria-label="Sair" className="rounded-[10px] p-2 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900">
        <LogOut size={16} />
      </button>
    </div>
  );

  return (
    <>
      {/* Computador */}
      <aside className="sticky top-0 hidden h-screen w-[236px] shrink-0 flex-col gap-2 p-2 pr-0 lg:flex">
        <div className="black-painel flex h-[60px] items-center px-4"><Marca nome={nomeBarbearia} /></div>
        <div className="black-painel flex min-h-0 flex-1 flex-col p-3">
        <nav aria-label="Menu principal" className="flex-1 space-y-5 overflow-y-auto">
          {[
            { titulo: "Dia a dia", rotas: ["/painel", "/recepcao", "/caixa", "/comandas", "/conversas", "/semana", "/minha-agenda"] },
            { titulo: "Gestão", rotas: ["/financeiro", "/meu-financeiro", "/campanhas-equipe", "/indicadores", "/assinaturas", "/estoque", "/campanhas", "/planos", "/jogos"] },
            { titulo: "Equipe e ajustes", rotas: ["/checklist", "/rh", "/recrutamento", "/expediente", "/equipe", "/whatsapp", "/auditoria", "/simulador"] },
          ].map((g) => {
            const itens = links.filter((l) => g.rotas.includes(l.href) || (g.titulo === "Gestão" && l.href.startsWith("/indicadores/")));
            return itens.length > 0 && <div key={g.titulo}><p className="mb-1.5 px-3 text-xs text-zinc-400">{g.titulo}</p><div className="space-y-0.5">{itens.map(item)}</div></div>;
          })}
        </nav>
        {links.some((l) => l.href === "/cultura-black") && <div className="mt-3 border-t border-[rgba(255,255,255,0.05)] pt-3">{item(links.find((l) => l.href === "/cultura-black")!)}</div>}
        </div>
        {rodapeUsuario}
      </aside>

      {/* Celular: topo com a marca + barra inferior */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-[rgba(255,255,255,0.05)] bg-fundo/80 px-4 py-3 backdrop-blur-[14px] lg:hidden">
        <Marca nome={nomeBarbearia} />
        <button onClick={sair} className="btn">Sair</button>
      </header>
      <nav className="fixed inset-x-0 bottom-0 z-40 flex justify-around border-t border-[rgba(255,255,255,0.05)] bg-fundo/85 p-2 backdrop-blur-[14px] lg:hidden">
        {links.slice(0, 4).map((l) => {
          const Icone = ICONES[l.href] ?? UserRound;
          return (
            <Link key={l.href} href={l.href}
              className={`flex min-w-16 flex-col items-center gap-1 py-1 text-[10px] ${ativo(l.href) ? "text-ouro" : "text-zinc-500"}`}>
              <Icone size={18} />
              {l.rotulo}
            </Link>
          );
        })}
        {links.length > 4 && (
          <button onClick={() => setMais(!mais)}
            className={`relative flex min-w-16 flex-col items-center gap-1 py-1 text-[10px] ${mais ? "text-ouro" : "text-zinc-500"}`}>
            {links.slice(4).some((l) => selos[l.href]) && <span className="absolute right-4 top-0 h-2 w-2 rounded-full bg-amber-500" />}
            {mais ? <X size={18} /> : <Menu size={18} />}
            Mais
          </button>
        )}
      </nav>
      {mais && (
        <div className="fixed inset-0 z-30 bg-[rgba(5,6,7,0.72)] backdrop-blur-[14px] lg:hidden" onClick={() => setMais(false)}>
          <div className="entrar-suave black-painel absolute inset-x-3 bottom-20 max-h-[70vh] space-y-0.5 overflow-y-auto p-2" onClick={(e) => e.stopPropagation()}>
            {links.slice(4).map(item)}
          </div>
        </div>
      )}
    </>
  );
}
