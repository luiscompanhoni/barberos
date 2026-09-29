import Link from "next/link";
import { redirect } from "next/navigation";
import { BotaoSair } from "@/components/cliente/BotaoSair";
import { configuracao } from "@/lib/agenda/carregar";
import { sessaoAtual } from "@/lib/auth/sessao";

export default async function LayoutCliente({ children }: { children: React.ReactNode }) {
  const s = await sessaoAtual();
  if (!s) redirect("/c/entrar");
  if (s.papel !== "CLIENTE") redirect("/");
  const cfg = await configuracao();

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <Link href="/c" className="font-semibold">{cfg.nomeBarbearia}</Link>
          <nav className="ml-auto flex items-center gap-1 text-sm">
            <Link href="/c/agendar" className="rounded-lg bg-zinc-900 px-3 py-1.5 text-white">Agendar</Link>
            <Link href="/c/perfil" className="rounded-lg px-3 py-1.5 text-zinc-600 hover:bg-zinc-100">Perfil</Link>
            <BotaoSair />
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 p-4">{children}</main>
    </div>
  );
}
