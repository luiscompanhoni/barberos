"use client";

import { useEffect, useState } from "react";
import { useAcesso } from "@/components/AcessoContexto";
import { api, reais } from "@/lib/cliente-api";
import type { ConferenciaPlano } from "@/lib/clientes/conferencia-plano";

const situacao = {
  PAGO_CELCOIN: "Pagamento confirmado no provedor",
  VENCIDO_NA_CELCOIN: "Parcela aberta após o vencimento no corte",
  PAGO_FORA: "Pagamento externo informado, sujeito a comprovante",
  DADOS_A_CONFERIR: "Transação a conferir",
  CANCELADO: "Última parcela cancelada",
  SEM_CICLO: "Sem parcela identificada até o corte",
  VENCE_HOJE: "Parcela com vencimento no dia do corte",
  SEM_CICLO_ATUAL_COMPROVADO: "Pagamento referente a ciclo anterior",
} satisfies Record<ConferenciaPlano["contratos"][number]["situacao"], string>;
const data = (iso: string) => iso.split("-").reverse().join("/");

export function ConferenciaPlanoCliente({ clienteId }: { clienteId: string }) {
  const { papel } = useAcesso();
  const autorizado = ["DONO", "GERENTE", "RECEPCAO"].includes(papel);
  const [resposta, setResposta] = useState<{ id: string; conferencia: ConferenciaPlano | null; falhou?: boolean } | null>(null);
  useEffect(() => {
    if (!autorizado) return;
    let vigente = true;
    api<{ conferencia: ConferenciaPlano | null }>(`/api/clientes/${encodeURIComponent(clienteId)}/conferencia-plano`)
      .then(r => { if (vigente) setResposta({ id: clienteId, conferencia: r.conferencia }); })
      .catch(() => { if (vigente) setResposta({ id: clienteId, conferencia: null, falhou: true }); });
    return () => { vigente = false; };
  }, [autorizado, clienteId]);

  if (!autorizado || resposta?.id !== clienteId) return null;
  if (resposta.falhou) return <p className="mt-2 text-xs text-zinc-600">A consulta ao histórico da Celcoin está indisponível.</p>;
  const c = resposta.conferencia;
  if (!c) return null;
  return <section className="mt-2 space-y-1 rounded-lg border border-zinc-200 p-3 text-sm" aria-label="Histórico de conferência da Celcoin">
    <h3 className="font-semibold">Histórico Celcoin de {data(c.dataCorte)}</h3>
    <ul className="space-y-1">{c.contratos.map((p, i) => <li key={i}>
      <span className="font-medium">{p.plano} · {reais(p.valorCentavos)}</span>
      <span className="block text-xs text-zinc-600">{situacao[p.situacao]}{p.vencimento ? ` · vencimento ${data(p.vencimento)}` : ""}</span>
      {p.proximoVencimento && <span className="block text-xs text-zinc-600">Próxima parcela prevista no corte em {data(p.proximoVencimento)}</span>}
    </li>)}</ul>
    {c.confirmacaoGerencial && <p className="text-xs">Decisão da gestão neste ciclo: {c.confirmacaoGerencial.plano}, com acesso até {data(c.confirmacaoGerencial.acessoAteInclusive)} inclusive.</p>}
    <p className="text-xs text-zinc-600">A cobertura deste atendimento segue as regras da assinatura no BarberOS. Confira mudanças posteriores ao corte.</p>
  </section>;
}
