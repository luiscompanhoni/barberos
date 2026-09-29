"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const PAPEIS: Record<string, string> = { DONO: "Dono", RECEPCAO: "Recepção", BARBEIRO: "Barbeiro" };

export function Navegacao({
  nome,
  papel,
  links,
}: {
  nome: string;
  papel: string;
  links: { href: string; rotulo: string }[];
}) {
  const path = usePathname();
  const router = useRouter();

  async function sair() {
    await fetch("/api/auth/sair", { method: "POST" });
    router.replace("/entrar");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1400px] items-center gap-2 overflow-x-auto px-3 py-2 sm:px-4">
        <span className="mr-2 shrink-0 font-semibold">BarberOS</span>
        <nav className="flex gap-1">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-sm ${
                path.startsWith(l.href) ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"
              }`}
            >
              {l.rotulo}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-2 text-sm">
          <span className="hidden text-zinc-500 sm:inline">
            {nome} · {PAPEIS[papel] ?? papel}
          </span>
          <button className="btn" onClick={sair}>Sair</button>
        </div>
      </div>
    </header>
  );
}
