import { redirect } from "next/navigation";
import { sessaoAtual } from "@/lib/auth/sessao";
import { Navegacao } from "@/components/Navegacao";
import { AbasPainel } from "@/components/AbasPainel";
import { provedorWhatsApp } from "@/lib/whatsapp/canal";
import { configuracao } from "@/lib/agenda/carregar";
import { contarPendentes } from "@/lib/estornos/servico";

export default async function LayoutApp({ children }: LayoutProps<"/">) {
  const s = await sessaoAtual();
  if (!s) redirect("/entrar");
  if (s.papel === "CLIENTE") redirect("/c");

  const links =
    s.papel === "BARBEIRO"
      ? [
          { href: "/minha-agenda", rotulo: "Minha agenda" },
          { href: "/recepcao", rotulo: "Barbearia hoje" },
          { href: "/comandas", rotulo: "Comandas" },
          { href: "/expediente", rotulo: "Meus horários" },
          ...(s.barbeiroId ? [{ href: `/indicadores/barbeiro/${s.barbeiroId}`, rotulo: "Meus números" }] : []),
        ]
      : [
          { href: "/painel", rotulo: "Painel" },
          { href: "/recepcao", rotulo: "Recepção" },
          { href: "/comandas", rotulo: "Comandas" },
          { href: "/conversas", rotulo: "Conversas" },
          { href: "/semana", rotulo: "Semana" },
          { href: "/assinaturas", rotulo: "Assinaturas" },
          { href: "/estoque", rotulo: "Estoque" },
          { href: "/financeiro", rotulo: "Financeiro" },
          { href: "/checklist", rotulo: "Checklist" },
          { href: "/roleta", rotulo: "Roleta" },
          ...(s.papel === "DONO"
            ? [
                { href: "/indicadores", rotulo: "Indicadores" },
                { href: "/rh", rotulo: "RH" },
                { href: "/planos", rotulo: "Planos" },
                { href: "/expediente", rotulo: "Horários" },
                { href: "/equipe", rotulo: "Configurações" },
                { href: "/whatsapp", rotulo: "WhatsApp" },
                { href: "/auditoria", rotulo: "Auditoria" },
                ...(provedorWhatsApp() === "simulador" ? [{ href: "/simulador", rotulo: "Simulador" }] : []),
              ]
            : []),
        ];

  // Selo de pendencias no menu: pedidos de estorno esperando o dono.
  const selos: Record<string, number> = s.papel === "DONO" ? { "/financeiro": await contarPendentes() } : {};

  return (
    <div className="flex min-h-full flex-1 flex-col lg:flex-row">
      <Navegacao nome={s.nome} papel={s.papel} links={links} selos={selos} nomeBarbearia={(await configuracao()).nomeBarbearia} />
      <main className="mx-auto w-full min-w-0 max-w-[1400px] flex-1 p-3 pb-24 sm:p-4 sm:pb-24 lg:p-6 lg:pb-6">
        <AbasPainel links={links} chave={s.usuarioId} />
        {children}
      </main>
    </div>
  );
}
