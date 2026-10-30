import { redirect } from "next/navigation";
import { AcessoProvider } from "@/components/AcessoContexto";
import { permissoesDoUsuario } from "@/lib/auth/permissoes";
import { GESTAO, sessaoAtual } from "@/lib/auth/sessao";
import { Navegacao } from "@/components/Navegacao";
import { AbasPainel } from "@/components/AbasPainel";
import { provedorWhatsApp } from "@/lib/whatsapp/canal";
import { configuracao } from "@/lib/agenda/carregar";
import { contarPendentes } from "@/lib/estornos/servico";
import { AcabamentoBlack } from "@/components/visual/AcabamentoBlack";
import { RegistroApp } from "@/components/notificacoes/RegistroApp";

export const metadata = { manifest: "/manifest-equipe.webmanifest" };

export default async function LayoutApp({ children }: LayoutProps<"/">) {
  const s = await sessaoAtual();
  if (!s) redirect("/entrar");
  if (s.papel === "CLIENTE") redirect("/c");
  const permissoes = await permissoesDoUsuario(s);

  const links =
    s.papel === "BARBEIRO" || s.papel === "LIDER"
      ? [
          ...(s.barbeiroId ? [{ href: "/minha-agenda", rotulo: "Minha agenda" }] : []),
          { href: "/recepcao", rotulo: "Barbearia hoje" },
          { href: "/comandas", rotulo: "Comandas" },
          { href: "/meu-financeiro", rotulo: "Meu financeiro" },
          { href: "/campanhas-equipe", rotulo: "Campanhas e bônus" },
          { href: "/expediente", rotulo: "Meus horários" },
          ...(s.barbeiroId ? [{ href: `/indicadores/barbeiro/${s.barbeiroId}`, rotulo: "Meus números" }] : []),
        ]
      : [
          { href: "/painel", rotulo: "Painel" },
          { href: "/recepcao", rotulo: "Recepção" },
          { href: "/caixa", rotulo: "Caixa" },
          { href: "/conversas", rotulo: "Conversas" },
          { href: "/comandas", rotulo: "Comandas" },
          { href: "/semana", rotulo: "Semana" },
          { href: "/assinaturas", rotulo: "Assinaturas" },
          { href: "/estoque", rotulo: "Estoque" },
          { href: "/financeiro", rotulo: "Financeiro" },
          { href: "/meu-financeiro", rotulo: "Meu financeiro" },
          ...(GESTAO.includes(s.papel) ? [{ href: "/campanhas-equipe", rotulo: "Campanhas da equipe" }] : []),
          { href: "/checklist", rotulo: "Checklist" },
          { href: "/jogos", rotulo: "Jogos" },
          ...(permissoes.resultado ? [{ href: "/indicadores", rotulo: "Indicadores" }] : []),
          ...(permissoes.folha || permissoes.comissao ? [{ href: "/rh", rotulo: "RH" }] : []),
          ...(GESTAO.includes(s.papel)
            ? [
                { href: "/campanhas", rotulo: "Campanhas" },
                { href: "/recrutamento", rotulo: "Recrutamento" },
                { href: "/planos", rotulo: "Planos" },
                { href: "/expediente", rotulo: "Horários" },
                { href: "/equipe", rotulo: "Configurações" },
              ]
            : []),
          ...(s.papel === "DONO"
            ? [
                { href: "/whatsapp", rotulo: "WhatsApp" },
                { href: "/auditoria", rotulo: "Auditoria" },
                ...(provedorWhatsApp() === "simulador" ? [{ href: "/simulador", rotulo: "Simulador" }] : []),
              ]
            : []),
        ];

  if (s.barbeiroId) links.unshift({ href: "/meu-dia", rotulo: "Meu dia" });
  if (permissoes.reunioes && ["DONO", "GERENTE", "LIDER"].includes(s.papel)) {
    links.splice(1, 0, { href: "/reunioes", rotulo: "Reuniões" });
  }
  links.push({ href: "/desempenho", rotulo: "Presença e desempenho" });
  if (s.barbeiroId || ["DONO", "GERENTE", "LIDER"].includes(s.papel)) {
    links.push({ href: "/avaliacoes", rotulo: "Avaliações dos clientes" });
  }
  if (s.papel === "DONO") links.push({ href: "/recompras", rotulo: "Recompra e custos" });
  links.push({ href: "/cultura-black", rotulo: "Cultura Black" });
  links.push({ href: "/notificacoes", rotulo: "App e notificações" });

  // Selo de pendencias no menu: pedidos de estorno esperando quem aprova.
  const selos: Record<string, number> = permissoes.estorno ? { "/financeiro": await contarPendentes() } : {};

  return (
    <div className="gestao-shell black-workspace flex min-h-full flex-1 flex-col lg:flex-row">
      <AcabamentoBlack />
      <RegistroApp area="equipe" />
      <Navegacao nome={s.nome} papel={s.papel} links={links} selos={selos} nomeBarbearia={(await configuracao()).nomeBarbearia} />
      <main className="mx-auto w-full min-w-0 max-w-[1400px] flex-1 p-3 pb-24 sm:p-4 sm:pb-24 lg:p-6 lg:pb-6">
        <AbasPainel links={links} chave={s.usuarioId} />
        <AcessoProvider valor={{ papel: s.papel, permissoes }}>{children}</AcessoProvider>
      </main>
    </div>
  );
}
