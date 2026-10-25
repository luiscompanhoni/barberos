import { habilitado as estudioHabilitado } from "@/lib/estudio/http";
import { redirect } from "next/navigation";
import { AcessoProvider } from "@/components/AcessoContexto";
import { permissoesDe } from "@/lib/auth/permissoes";
import { GESTAO, sessaoAtual } from "@/lib/auth/sessao";
import { Navegacao } from "@/components/Navegacao";
import { AbasPainel } from "@/components/AbasPainel";
import { provedorWhatsApp } from "@/lib/whatsapp/canal";
import { configuracao } from "@/lib/agenda/carregar";
import { contarPendentes } from "@/lib/estornos/servico";
import { AcabamentoBlack } from "@/components/visual/AcabamentoBlack";

export default async function LayoutApp({ children }: LayoutProps<"/">) {
  const s = await sessaoAtual();
  if (!s) redirect("/entrar");
  if (s.papel === "CLIENTE") redirect("/c");
  const permissoes = await permissoesDe(s.papel);

  const links =
    s.papel === "BARBEIRO"
      ? [
          { href: "/minha-agenda", rotulo: "Minha agenda" },
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

  if (estudioHabilitado()) links.push({ href: "/estudio", rotulo: "Estúdio Black" });
  links.push({ href: "/cultura-black", rotulo: "Cultura Black" });

  // Selo de pendencias no menu: pedidos de estorno esperando quem aprova.
  const selos: Record<string, number> = permissoes.estorno ? { "/financeiro": await contarPendentes() } : {};

  return (
    <div className="gestao-shell black-workspace flex min-h-full flex-1 flex-col lg:flex-row">
      <AcabamentoBlack />
      <Navegacao nome={s.nome} papel={s.papel} links={links} selos={selos} nomeBarbearia={(await configuracao()).nomeBarbearia} />
      <main className="mx-auto w-full min-w-0 max-w-[1400px] flex-1 p-3 pb-24 sm:p-4 sm:pb-24 lg:p-6 lg:pb-6">
        <AbasPainel links={links} chave={s.usuarioId} />
        <AcessoProvider valor={{ papel: s.papel, permissoes }}>{children}</AcessoProvider>
      </main>
    </div>
  );
}
