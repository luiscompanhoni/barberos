import Link from "next/link";
import { redirect } from "next/navigation";
import { BotaoSair } from "@/components/cliente/BotaoSair";
import { NavCliente } from "@/components/cliente/NavCliente";
import { Marca } from "@/components/Marca";
import { configuracao } from "@/lib/agenda/carregar";
import { sessaoAtual } from "@/lib/auth/sessao";

export default async function LayoutCliente({ children }: { children: React.ReactNode }) {
  const s = await sessaoAtual();
  if (!s) redirect("/c/entrar");
  if (s.papel !== "CLIENTE") redirect("/");
  const cfg = await configuracao();

  return (
    <div className="flex min-h-full flex-1 flex-col pb-20">
      <header className="sticky top-0 z-30 border-b border-zinc-200 bg-fundo/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-3">
          <Link href="/c"><Marca nome={cfg.nomeBarbearia} /></Link>
          <BotaoSair />
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-6">{children}</main>
      <NavCliente />
    </div>
  );
}
