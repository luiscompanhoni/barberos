"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarPlus, Crown, Dices, House, Star, UserRound, Wallet } from "lucide-react";

const ABAS = [
  { href: "/c", rotulo: "Início", Icone: House },
  { href: "/c/agendar", rotulo: "Agendar", Icone: CalendarPlus },
  { href: "/c/planos", rotulo: "Planos", Icone: Crown },
  { href: "/c/jogos", rotulo: "Jogos", Icone: Dices },
  { href: "/c/avaliacoes", rotulo: "Avaliar", Icone: Star },
  { href: "/c/saldo", rotulo: "Saldo", Icone: Wallet },
  { href: "/c/perfil", rotulo: "Perfil", Icone: UserRound },
];

/** Barra inferior da area do cliente (estilo app). */
export function NavCliente({ jogos = false, avaliacoes = false }: { jogos?: boolean; avaliacoes?: boolean }) {
  const path = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-200 bg-fundo/95 backdrop-blur">
      <div className="mx-auto flex max-w-2xl justify-around overflow-x-auto px-2 py-2.5">
        {ABAS.filter((a) => (jogos || a.href !== "/c/jogos") && (avaliacoes || a.href !== "/c/avaliacoes")).map(({ href, rotulo, Icone }) => {
          const ativo = href === "/c" ? path === "/c" : path.startsWith(href);
          return (
            <Link key={href} href={href} className={`flex min-w-12 flex-col items-center gap-1 text-[10px] font-semibold ${ativo ? "text-ouro" : "text-zinc-500"}`}>
              <Icone size={19} />
              {rotulo}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
