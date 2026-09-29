import { redirect } from "next/navigation";
import { sessaoAtual } from "@/lib/auth/sessao";
import { Navegacao } from "@/components/Navegacao";
import { provedorWhatsApp } from "@/lib/whatsapp/canal";

export default async function LayoutApp({ children }: LayoutProps<"/">) {
  const s = await sessaoAtual();
  if (!s) redirect("/entrar");
  if (s.papel === "CLIENTE") redirect("/c");

  const links =
    s.papel === "BARBEIRO"
      ? [
          { href: "/minha-agenda", rotulo: "Minha agenda" },
          { href: "/recepcao", rotulo: "Barbearia hoje" },
          { href: "/expediente", rotulo: "Meus horários" },
        ]
      : [
          { href: "/painel", rotulo: "Painel" },
          { href: "/recepcao", rotulo: "Recepção" },
          { href: "/semana", rotulo: "Semana" },
          { href: "/conversas", rotulo: "Conversas" },
          ...(s.papel === "DONO"
            ? [
                { href: "/expediente", rotulo: "Horários da equipe" },
                { href: "/equipe", rotulo: "Equipe e configurações" },
                ...(provedorWhatsApp() === "simulador" ? [{ href: "/simulador", rotulo: "Simulador" }] : []),
              ]
            : []),
        ];

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <Navegacao nome={s.nome} papel={s.papel} links={links} />
      <main className="mx-auto w-full max-w-[1400px] flex-1 p-3 sm:p-4">{children}</main>
    </div>
  );
}
