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
  "/roleta": Dices,
  "/financeiro": Landmark,
  "/checklist": ClipboardCheck,
  "/rh": BriefcaseBusiness,
  "/whatsapp": Smartphone,
  "/auditoria": ShieldCheck,
  "/campanhas": Megaphone,
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
        className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
          ativo(l.href) ? "bg-zinc-200 font-semibold text-zinc-900" : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
        }`}
      >
        <Icone size={17} className={ativo(l.href) ? "text-ouro" : ""} />
        {l.rotulo}
        {!!selos[l.href] && <span className="ml-auto rounded-full bg-amber-500 px-1.5 text-[11px] font-bold text-black" title="Pendências">{selos[l.href]}</span>}
      </Link>
    );
  };

  const rodapeUsuario = (
    <div className="flex items-center gap-3 border-t border-zinc-200 pt-4">
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-zinc-200 text-xs font-bold text-ouro">{iniciais(nome)}</div>
      <Link href="/conta" className="min-w-0 flex-1 hover:text-ouro" title="Minha conta e senha">
        <p className="truncate text-sm font-semibold">{nome}</p>
        <p className="text-xs text-zinc-500">{PAPEIS[papel] ?? papel} · minha conta</p>
      </Link>
      <button onClick={sair} title="Sair" aria-label="Sair" className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900">
        <LogOut size={16} />
      </button>
    </div>
  );

  return (
    <>
      {/* Computador */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-zinc-200 bg-[#0d0d0d] p-5 lg:flex">
        <Marca nome={nomeBarbearia} />
        <nav className="mt-10 flex-1 space-y-1 overflow-y-auto">{links.map(item)}</nav>
        {rodapeUsuario}
      </aside>

      {/* Celular: topo com a marca + barra inferior */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-zinc-200 bg-fundo/90 px-4 py-3 backdrop-blur-md lg:hidden">
        <Marca nome={nomeBarbearia} />
        <button onClick={sair} className="btn">Sair</button>
      </header>
      <nav className="fixed inset-x-0 bottom-0 z-40 flex justify-around border-t border-zinc-200 bg-fundo/95 p-2 backdrop-blur lg:hidden">
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
        <div className="fixed inset-0 z-30 bg-black/60 lg:hidden" onClick={() => setMais(false)}>
          <div className="entrar-suave absolute inset-x-3 bottom-20 rounded-2xl border border-zinc-200 bg-white p-2" onClick={(e) => e.stopPropagation()}>
            {links.slice(4).map(item)}
          </div>
        </div>
      )}
    </>
  );
}
