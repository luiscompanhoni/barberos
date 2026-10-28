import Link from "next/link";
import { redirect } from "next/navigation";
import { BotaoSair } from "@/components/cliente/BotaoSair";
import { NavCliente } from "@/components/cliente/NavCliente";
import { Marca } from "@/components/Marca";
import { configuracao } from "@/lib/agenda/carregar";
import { sessaoAtual } from "@/lib/auth/sessao";
import { marcarAppAberto } from "@/lib/campanhas/link";
import { db } from "@/lib/db";
import { RegistroApp } from "@/components/notificacoes/RegistroApp";
import { SinoNotificacoes } from "@/components/notificacoes/SinoNotificacoes";

export default async function LayoutCliente({ children }: { children: React.ReactNode }) {
  const s = await sessaoAtual();
  if (!s) redirect("/c/entrar");
  if (s.papel !== "CLIENTE") redirect("/");
  // Funil das campanhas: entrou no app depois de receber a mensagem.
  if (s.clienteId) await marcarAppAberto(s.clienteId).catch((e) => console.error("[campanhas] app aberto", e));
  const cfg = await configuracao();
  const [jogos, avaliacao] = await Promise.all([
    db.jogo.count({ where: { ativo: true } }),
    db.avaliacaoConfig.findUnique({ where: { id: 1 }, select: { ativo: true } }),
  ]);

  return (
    <div className="flex min-h-full flex-1 flex-col pb-20">
      <RegistroApp area="cliente" />
      <header className="sticky top-0 z-30 border-b border-zinc-200 bg-fundo/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-3">
          <Link href="/c"><Marca nome={cfg.nomeBarbearia} /></Link>
          <div className="flex items-center gap-2"><SinoNotificacoes href="/c/notificacoes" area="cliente" /><BotaoSair /></div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-6">{children}</main>
      <NavCliente jogos={jogos > 0} avaliacoes={avaliacao?.ativo ?? false} />
    </div>
  );
}
