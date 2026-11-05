import type { PreviaPedido } from "@/lib/agenda/pedidos-previa";
import { reais } from "@/lib/cliente-api";

export function PreviaPedidoAgendamento({ previa }: { previa: PreviaPedido }) {
  const hora = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
  return <div className="rounded-xl border border-ouro/30 p-4 text-sm" aria-live="polite">
    <p className="font-semibold">Prévia com {previa.profissional}: {hora(previa.inicio)} às {hora(previa.fim)} · {previa.duracaoMin} min</p>
    <ul className="mt-3 space-y-2">{previa.itens.map(item => <li key={item.id}>
      <span>{item.nome}: {item.duracaoMin} min · {item.peloPlano ? "incluído no plano" : reais(item.precoCentavos)}</span>
      {item.regraPlano && <p className="mt-1 text-xs text-amber-700">{item.regraPlano}</p>}
    </li>)}</ul>
    <p className="mt-3 font-semibold">Total a pagar: {reais(previa.precoCentavos)}</p>
    <p className="mt-1 text-xs text-zinc-500">Confira este intervalo completo na agenda principal. O sistema revalida preço e duração ao confirmar.</p>
  </div>;
}
