import { redirect } from "next/navigation";
import { sessaoAtual } from "@/lib/auth/sessao";
import { Navegacao } from "@/components/Navegacao";
import { provedorWhatsApp } from "@/lib/whatsapp/canal";
import { configuracao } from "@/lib/agenda/carregar";

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
          ...(s.papel === "DONO"
            ? [
                { href: "/indicadores", rotulo: "Indicadores" },
                { href: "/planos", rotulo: "Planos" },
                { href: "/expediente", rotulo: "Horários" },
                { href: "/equipe", rotulo: "Configurações" },
                ...(provedorWhatsApp() === "simulador" ? [{ href: "/simulador", rotulo: "Simulador" }] : []),
              ]
            : []),
        ];

  return (
    <div className="flex min-h-full flex-1 flex-col lg:flex-row">
      <Navegacao nome={s.nome} papel={s.papel} links={links} nomeBarbearia={(await configuracao()).nomeBarbearia} />
      <main className="mx-auto w-full min-w-0 max-w-[1400px] flex-1 p-3 pb-24 sm:p-4 sm:pb-24 lg:p-6 lg:pb-6">{children}</main>
    </div>
  );
}
