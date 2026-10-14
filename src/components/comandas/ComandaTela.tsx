"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, Gift, Link2, Minus, Plus, Scissors, Trash2 } from "lucide-react";
import { useAcesso } from "@/components/AcessoContexto";
import { BotaoCopiar, NovoLinkModal } from "@/components/financeiro/NovoLinkModal";
import { api, centavosParaTexto, paraCentavos, reais } from "@/lib/cliente-api";
import { Catalogo } from "./Catalogo";
import { Recebimento } from "./Recebimento";
import { nomeDaComanda, type Comanda, type Forma, type ModoMaquininha } from "./tipos";
import { useAoVivo } from "./useAoVivo";
import { PremiosComanda } from "@/components/jogos/PremiosComanda";

type Resposta = { comanda: Comanda; maquininha?: ModoMaquininha; resultado?: { troco: number; alertas: string[]; cashbackCentavos?: number } | null };

export function ComandaTela({ id, papel }: { id: string; papel: string }) {
  const [c, setC] = useState<Comanda | null>(null);
  const [maquininha, setMaquininha] = useState<ModoMaquininha>("manual");
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [fechamento, setFechamento] = useState<{ troco: number; alertas: string[]; cashbackCentavos?: number } | null>(null);
  const [desconto, setDesconto] = useState<string | null>(null);
  const [cobrarLink, setCobrarLink] = useState(false);
  const gerente = papel === "DONO" || papel === "GERENTE" || papel === "RECEPCAO";
  const pode = useAcesso().permissoes;

  const carregar = useCallback(() => {
    api<Resposta>(`/api/comandas/${id}`).then((r) => { setC(r.comanda); if (r.maquininha) setMaquininha(r.maquininha); }).catch((e) => setErro(e.message));
  }, [id]);
  useEffect(carregar, [carregar]);
  useAoVivo("comanda", carregar);

  /** Chama a API, atualiza a tela com a comanda devolvida e mostra erro se houver. */
  async function executar(url: string, body: unknown, method = "PATCH") {
    setErro("");
    setOcupado(true);
    try {
      const r = await api<Resposta>(url, { method, body });
      setC(r.comanda);
      if (r.resultado) setFechamento(r.resultado);
      return true;
    } catch (e) {
      setErro((e as Error).message);
      return false;
    } finally {
      setOcupado(false);
    }
  }

  if (!c) return <p className="text-sm text-zinc-500">{erro || "Carregando..."}</p>;
  const r = c.resumo;
  const aberta = c.status === "ABERTA";
  const emLinks = (c.linksPagamento ?? []).reduce((t, l) => t + l.valorCentavos, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/comandas" className="btn h-9 w-9 p-0" aria-label="Voltar"><ArrowLeft size={16} /></Link>
        <div>
          <p className="text-xs font-bold text-ouro">Comanda #{c.numero}</p>
          <h1 className="titulo-marca text-2xl">{nomeDaComanda(c)}</h1>
        </div>
        {c.status !== "ABERTA" && (
          <span className={c.status === "FECHADA" ? "selo-ouro ml-auto" : "ml-auto rounded-full bg-red-50 px-2.5 py-1 text-[10px] font-bold text-red-700 uppercase"}>
            {c.status === "FECHADA" ? "Fechada" : "Cancelada"}
          </span>
        )}
        {!!r.estornado && (
          <span className={`${c.status === "ABERTA" ? "ml-auto " : ""}rounded-full bg-red-50 px-2.5 py-1 text-[10px] font-bold text-red-700 uppercase`} title="Parte do valor foi devolvida ao cliente">
            {r.estornado >= r.pago + r.estornado ? "Estornada" : "Estorno parcial"}
          </span>
        )}
      </div>

      {erro && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
      {fechamento && (
        <div className="cartao-destaque flex items-start gap-3">
          <CheckCircle2 className="shrink-0 text-ouro" />
          <div className="text-sm">
            <p className="font-bold">Comanda fechada.</p>
            {fechamento.troco > 0 && <p className="mt-1 text-lg font-black text-ouro">Troco: {reais(fechamento.troco)}</p>}
            {!!fechamento.cashbackCentavos && <p className="mt-1">O cliente ganhou <b className="text-ouro">{reais(fechamento.cashbackCentavos)}</b> de cashback.</p>}
            {fechamento.alertas.map((a) => <p key={a} className="mt-1 text-amber-800">{a}</p>)}
          </div>
        </div>
      )}

      <div className={`grid gap-4 ${aberta ? "lg:grid-cols-[1fr_400px]" : "max-w-xl"}`}>
        {aberta && (
          <Catalogo
            desabilitado={ocupado}
            podeAvulso={gerente}
            onProduto={(produtoId) => executar(`/api/comandas/${id}`, { acao: "produto", produtoId, quantidade: 1 })}
            onServico={c.cliente && c.itens.some((i) => i.agendamentoId) ? (servicoId, barbeiroId) => executar(`/api/comandas/${id}`, { acao: "servico", servicoId, barbeiroId }) : undefined}
            barbeiroPadrao={c.itens.find((i) => i.agendamentoId)?.barbeiroId ?? null}
            onAvulso={(descricao, precoCentavos) => executar(`/api/comandas/${id}`, { acao: "avulso", descricao, precoCentavos, quantidade: 1 })}
          />
        )}

        <div className="space-y-4">
          <section className="cartao space-y-3">
            {c.itens.length === 0 ? (
              <p className="py-4 text-center text-sm text-zinc-500">Toque nos produtos para lançar.</p>
            ) : (
              <ul className="divide-y divide-zinc-200">
                {c.itens.map((i) => (
                  <li key={i.id} className="flex items-center gap-2 py-2.5 text-sm">
                    {i.agendamentoId && <Scissors size={14} className="shrink-0 text-ouro" />}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{i.descricao}</p>
                      <p className="text-xs text-zinc-500">{reais(i.precoUnitCentavos)}{i.quantidade > 1 && ` × ${i.quantidade}`}</p>
                    </div>
                    {aberta && !i.agendamentoId && (
                      <div className="flex items-center gap-1">
                        <button disabled={ocupado} onClick={() => executar(`/api/comandas/itens/${i.id}`, { quantidade: i.quantidade - 1 })} className="rounded-lg border border-zinc-200 p-1 hover:border-zinc-400" aria-label="Menos um">
                          {i.quantidade === 1 ? <Trash2 size={13} /> : <Minus size={13} />}
                        </button>
                        <span className="w-6 text-center font-bold">{i.quantidade}</span>
                        <button disabled={ocupado} onClick={() => executar(`/api/comandas/itens/${i.id}`, { quantidade: i.quantidade + 1 })} className="rounded-lg border border-zinc-200 p-1 hover:border-zinc-400" aria-label="Mais um">
                          <Plus size={13} />
                        </button>
                      </div>
                    )}
                    {aberta && i.agendamentoId && (
                      <button disabled={ocupado} onClick={() => executar(`/api/comandas/itens/${i.id}`, { quantidade: 0 })} className="rounded-lg p-1 text-zinc-500 hover:text-red-600" aria-label="Tirar serviço">
                        <Trash2 size={13} />
                      </button>
                    )}
                    <span className="w-20 text-right font-semibold">{reais(i.quantidade * i.precoUnitCentavos)}</span>
                  </li>
                ))}
              </ul>
            )}

            <div className="space-y-1 border-t border-zinc-200 pt-3 text-sm">
              {r.desconto > 0 && <Linha rotulo="Subtotal" valor={reais(r.subtotal)} />}
              {desconto !== null ? (
                <form className="flex items-center gap-2" onSubmit={async (e) => {
                  e.preventDefault();
                  const v = desconto.trim() ? paraCentavos(desconto) : 0;
                  if (!Number.isNaN(v) && (await executar(`/api/comandas/${id}`, { acao: "desconto", descontoCentavos: v }))) setDesconto(null);
                }}>
                  <span className="text-zinc-500">Desconto R$</span>
                  <input className="campo w-24 py-1" inputMode="decimal" autoFocus value={desconto} onChange={(e) => setDesconto(e.target.value)} />
                  <button className="btn py-1 text-xs">Aplicar</button>
                </form>
              ) : r.desconto > 0 ? (
                <Linha rotulo="Desconto" valor={`− ${reais(r.desconto)}`} />
              ) : null}
              <div className="flex items-baseline justify-between pt-1">
                <span className="font-semibold">Total</span>
                <span className="text-2xl font-black">{reais(r.total)}</span>
              </div>
              {!!r.estornado && <Linha rotulo="Estornado" valor={`− ${reais(r.estornado)}`} />}
              {r.pago > 0 && <Linha rotulo={r.estornado ? "Ficou com a barbearia" : "Recebido"} valor={reais(r.pago)} />}
              {aberta && r.falta > 0 && r.pago + r.aguardando > 0 && <Linha rotulo="Falta" valor={reais(r.falta)} forte />}
              {r.troco > 0 && <Linha rotulo="Troco" valor={reais(r.troco)} forte />}
              {aberta && pode.desconto && desconto === null && c.itens.length > 0 && (
                <button className="text-xs font-semibold text-zinc-500 hover:text-zinc-900" onClick={() => setDesconto(r.desconto ? centavosParaTexto(r.desconto) : "")}>
                  {r.desconto ? "Mudar desconto" : "Dar desconto"}
                </button>
              )}
            </div>
          </section>

          {aberta && !!c.saldoCliente && pode.saldo && (
            <section className="cartao-destaque flex flex-wrap items-center gap-3">
              <Gift size={18} className="shrink-0 text-ouro" />
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-semibold">Saldo do cliente: <span className="text-ouro">{reais(c.saldoCliente)}</span></p>
                <p className="text-xs text-zinc-500">Cashback e indicações. Vira desconto nesta comanda.</p>
              </div>
              <button className="btn-primario" disabled={ocupado || c.itens.length === 0 || r.total === 0}
                onClick={() => executar(`/api/comandas/${id}`, { acao: "saldo" })}>Usar saldo</button>
            </section>
          )}

          {!!c.premios?.length && <PremiosComanda comandaId={id} premios={c.premios} aberta={aberta} aoMudar={carregar} />}

          {(c.itens.length > 0 || c.pagamentos.length > 0) && (
            <section className="cartao space-y-3">
              <h2 className="rotulo">Pagamento</h2>
              {(c.linksPagamento ?? []).map((l) => (
                <div key={l.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-ouro/40 bg-ouro/5 p-3 text-sm">
                  <Link2 size={16} className="text-ouro" />
                  <span className="font-semibold">Link enviado</span>
                  <span className="text-xs text-zinc-500">aguardando o cliente pagar</span>
                  <span className="ml-auto font-bold">{reais(l.valorCentavos)}</span>
                  {l.url && <BotaoCopiar texto={l.url} className="btn w-full py-1 text-xs" />}
                </div>
              ))}
              <Recebimento
                comanda={c}
                maquininha={maquininha}
                gerente={gerente}
                aprovaEstorno={pode.estorno}
                ocupado={ocupado}
                onPagar={(p: { forma: Forma; valorCentavos: number; naMaquininha: boolean }) => executar(`/api/comandas/${id}/pagamentos`, p, "POST")}
                onAcaoPagamento={(pid, acao) => executar(`/api/comandas/pagamentos/${pid}`, { acao })}
                onEstorno={carregar}
              />
              {aberta && gerente && r.falta - emLinks > 0 && (
                <button className="btn w-full" disabled={ocupado} onClick={() => setCobrarLink(true)}>
                  <Link2 size={15} /> Cobrar por link (Pix ou cartão à distância)
                </button>
              )}
              {aberta && (
                <button className="btn-primario w-full py-3" disabled={ocupado || !r.podeFechar || c.itens.length === 0}
                  onClick={() => executar(`/api/comandas/${id}`, { acao: "fechar" })}>
                  {r.aguardando > 0 ? "Esperando a maquininha…" : r.podeFechar ? "Fechar comanda" : `Falta ${reais(r.falta)}`}
                </button>
              )}
            </section>
          )}

          {((aberta && gerente) || (c.status === "FECHADA" && pode.excluir)) && (
            <button className="text-xs font-semibold text-zinc-500 hover:text-red-600" disabled={ocupado}
              onClick={() => {
                const motivo = window.prompt(c.status === "FECHADA"
                  ? "Cancelar comanda já fechada: os produtos voltam ao estoque. O dinheiro NÃO volta sozinho: use “Estornar” em cada pagamento. Motivo:"
                  : "Motivo do cancelamento:");
                if (motivo && motivo.trim().length >= 2) executar(`/api/comandas/${id}`, { acao: "cancelar", motivo: motivo.trim() });
              }}>
              Cancelar comanda
            </button>
          )}
        </div>
      </div>
      {cobrarLink && (
        <NovoLinkModal
          comanda={{
            id: c.id, numero: c.numero, cliente: c.cliente, nomeAvulso: c.nomeAvulso,
            faltaCentavos: r.falta - emLinks,
          }}
          onFechar={() => setCobrarLink(false)}
          onCriado={() => carregar()}
        />
      )}
    </div>
  );
}

function Linha({ rotulo, valor, forte }: { rotulo: string; valor: string; forte?: boolean }) {
  return (
    <div className={`flex justify-between ${forte ? "font-bold text-ouro" : "text-zinc-500"}`}>
      <span>{rotulo}</span><span>{valor}</span>
    </div>
  );
}
