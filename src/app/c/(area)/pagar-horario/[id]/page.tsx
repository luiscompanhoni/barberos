import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Checkout } from "@/components/checkout/Checkout";
import { checkoutDoHorario, motivoParaNaoPagar } from "@/lib/agenda/antecipado";
import { configuracao } from "@/lib/agenda/carregar";
import { minParaHhmm, minutosLocal } from "@/lib/agenda/tempo";
import { cpfValido } from "@/lib/assinaturas/regras";
import { sessaoAtual } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { checkoutProprio, chavePublicaPagarme, modoCartaoCheckout } from "@/lib/pagamentos/checkout";
import { gateway } from "@/lib/pagamentos/gateway";

export const dynamic = "force-dynamic";

/** Checkout do BarberOS para pagar um horario avulso antes de vir (Pix ou cartao). */
export default async function PagarHorario(props: PageProps<"/c/pagar-horario/[id]">) {
  const s = await sessaoAtual();
  if (!s?.clienteId) redirect("/c/entrar");
  if (!checkoutProprio()) redirect("/c");
  const { id } = await props.params;
  const ag = await db.agendamento.findFirst({
    where: { id, clienteId: s.clienteId },
    include: { servico: { select: { nome: true } }, barbeiro: { select: { nome: true } }, cliente: { select: { cpf: true, email: true } } },
  });
  if (!ag) notFound();
  const cfg = await configuracao();
  const inicial = await checkoutDoHorario(s.clienteId, ag.id);
  const motivo = inicial.status === "PAGO" ? null : motivoParaNaoPagar(ag);
  const dia = new Date(ag.inicio).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", timeZone: cfg.fuso });
  const g = await gateway();

  return (
    <div className="mx-auto max-w-md">
      <Link href="/c" className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-500 hover:text-zinc-900"><ArrowLeft size={14} /> Meus horários</Link>
      {motivo ? (
        <p className="cartao mt-6 text-sm text-zinc-600">{motivo}</p>
      ) : (
        <Checkout
          alvo={{ tipo: "horario", id: ag.id }}
          resumo={{
            titulo: `${ag.servico.nome} com ${ag.barbeiro.nome}`,
            descricao: `${dia} às ${minParaHhmm(minutosLocal(ag.inicio, cfg.fuso))}`,
            valorCentavos: ag.precoCentavos,
          }}
          formas={["PIX", "CARTAO"]}
          modoCartao={modoCartaoCheckout()}
          chavePublica={chavePublicaPagarme()}
          pedir={{ cpf: !cpfValido(ag.cliente?.cpf ?? ""), email: g.exigeEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(ag.cliente?.email ?? "") }}
          inicial={inicial}
          sucesso={{ texto: "Horário pago. É só vir: o valor já entra na sua comanda. Se cancelar, ele vira saldo.", href: "/c", botao: "Ver meus horários" }}
        />
      )}
    </div>
  );
}
