"use client";

import { useEffect, useRef, useState } from "react";
import { Banknote, CreditCard, LoaderCircle, QrCode, X } from "lucide-react";
import { BotaoEstorno, SeloEstorno } from "@/components/estornos/BotaoEstorno";
import { api, centavosParaTexto, ErroApi, paraCentavos, reais } from "@/lib/cliente-api";
import { FORMAS, ROTULO_FORMA, type Comanda, type EstornoComanda, type Forma, type ModoMaquininha, type Pagamento } from "./tipos";

const ICONE: Record<Forma, typeof CreditCard> = { PIX: QrCode, CREDITO: CreditCard, DEBITO: CreditCard, DINHEIRO: Banknote };

/** Pagamentos lancados + formulario para receber (divide em quantas formas precisar). */
export function Recebimento({ comanda, maquininha, gerente, posDoBarbeiro, aprovaEstorno, ocupado, onPagar, onAcaoPagamento, onEstorno }: {
  comanda: Comanda;
  maquininha: ModoMaquininha;
  gerente: boolean;
  posDoBarbeiro: boolean;
  aprovaEstorno: boolean;
  ocupado: boolean;
  onPagar: (p: { forma: Forma; valorCentavos: number; naMaquininha: boolean; serial?: string; solicitacaoId?: string }, aoFalhar?: (e: unknown) => void) => Promise<boolean>;
  onAcaoPagamento: (id: string, acao: "cancelar" | "conferir" | "simular") => void;
  onEstorno?: () => void;
}) {
  const r = comanda.resumo;
  const [forma, setForma] = useState<Forma>("PIX");
  const [valor, setValor] = useState("");
  const [jaPassei, setJaPassei] = useState(false);
  const [maquinas, setMaquinas] = useState<{ serial: string; nome: string }[]>([]);
  const [serial, setSerial] = useState("");
  const [carregandoMaquinas, setCarregandoMaquinas] = useState(maquininha === "stone");
  const [erroLocal, setErroLocal] = useState("");
  const emVoo = useRef(false);
  const tentativa = useRef<{ chave: string; id: string } | null>(null);
  useEffect(() => {
    if (maquininha !== "stone" || !gerente) return;
    let ativo = true;
    api<{ maquininhas: { serial: string; nome: string }[] }>("/api/comandas/maquininhas").then((r) => {
      if (!ativo) return;
      setMaquinas(r.maquininhas);
      let salvo = "";
      try { salvo = localStorage.getItem("barberos:maquininha") ?? ""; } catch {}
      setSerial(r.maquininhas.some((m) => m.serial === salvo) ? salvo : (r.maquininhas[0]?.serial ?? ""));
    }).catch(() => { if (ativo) setErroLocal("Não foi possível carregar as maquininhas. Atualize a página antes de cobrar."); })
      .finally(() => { if (ativo) setCarregandoMaquinas(false); });
    return () => { ativo = false; };
  }, [maquininha, gerente]);
  const escolherMaquina = (v: string) => {
    setSerial(v);
    try { localStorage.setItem("barberos:maquininha", v); } catch {}
  };
  const aberta = comanda.status === "ABERTA";
  const podeEnviar = gerente || posDoBarbeiro;
  const formas = gerente ? FORMAS : FORMAS.filter((f) => f.valor === "DEBITO" || f.valor === "CREDITO");
  const bloqueado = ocupado || r.aguardando > 0 || !podeEnviar;
  const integrada = maquininha !== "manual" && forma !== "DINHEIRO";
  const reservadoEmLinks = (comanda.linksPagamento ?? []).reduce((total, l) => total + l.valorCentavos, 0);
  const disponivel = Math.max(0, r.falta - reservadoEmLinks);
  const maquinaPronta = posDoBarbeiro || maquininha !== "stone" || (!carregandoMaquinas && maquinas.some((m) => m.serial === serial));
  // Estornados continuam na lista (com o selo), para ficar visivel na comanda.
  const vivos = comanda.pagamentos.filter((p) => p.status !== "CANCELADO" || !!p.estornadoEm);
  const estornosDe = (p: Pagamento) => (comanda.estornos ?? []).filter((e) =>
    (e.tipo === "COMANDA" && e.referenciaId === p.id) || (e.tipo === "ANTECIPADO" && e.referenciaId === p.antecipadoId) || (e.tipo === "LINK" && e.referenciaId === p.linkPagamentoId));

  async function pagar(escolhida: Forma) {
    if (emVoo.current || bloqueado || reservadoEmLinks > 0) return;
    if (!gerente && (!posDoBarbeiro || maquininha !== "stone" || !formas.some(f => f.valor === escolhida))) return;
    setErroLocal("");
    const v = valor.trim() ? paraCentavos(valor) : disponivel;
    const enviarMaquina = maquininha !== "manual" && escolhida !== "DINHEIRO" && !jaPassei;
    if (!Number.isSafeInteger(v) || v <= 0) return setErroLocal("Informe um valor maior que zero.");
    if (disponivel <= 0 || (escolhida !== "DINHEIRO" && v > disponivel)) return setErroLocal("Esse valor já está pago ou reservado em outra cobrança. Confira os pagamentos e links em aberto.");
    if (enviarMaquina && !maquinaPronta) return setErroLocal("Escolha uma maquininha disponível antes de cobrar.");
    emVoo.current = true;
    try {
      const terminal = gerente && enviarMaquina ? serial || undefined : undefined;
      const chave = JSON.stringify([comanda.id, escolhida, v, terminal]);
      const enviarStone = enviarMaquina && maquininha === "stone";
      if (enviarStone && tentativa.current?.chave !== chave) tentativa.current = { chave, id: crypto.randomUUID() };
      const solicitacaoId = enviarStone ? tentativa.current?.id : undefined;
      const encerra = () => { if (solicitacaoId && tentativa.current?.id === solicitacaoId) tentativa.current = null; };
      if (await onPagar({ forma: escolhida, valorCentavos: v, naMaquininha: enviarMaquina, serial: terminal, solicitacaoId }, e => {
        if (e instanceof ErroApi && e.codigo === "maquininha") encerra();
      })) {
        encerra();
        setValor("");
      }
    } finally {
      emVoo.current = false;
    }
  }

  return (
    <div className="space-y-3">
      {vivos.length > 0 && (
        <ul className="space-y-2">
          {vivos.map((p) => (
            <LinhaPagamento key={p.id} p={p} aberta={aberta && gerente} maquininha={maquininha} ocupado={ocupado} onAcao={onAcaoPagamento}
              podeConferir={gerente || (posDoBarbeiro && (p.forma === "DEBITO" || p.forma === "CREDITO") && (!p.gatewayPedidoId || p.gatewayPedidoId.startsWith("or_")))}
              podeSimular={gerente}
              // Desfazer lancamento errado (sem dinheiro): so quem aprova estornos. Devolver dinheiro e estorno.
              podeDesfazer={aprovaEstorno && p.status === "PAGO" && !p.antecipadoId && !p.linkPagamentoId && !p.estornadoCentavos && (!p.gatewayPedidoId || p.gatewayPedidoId.startsWith("sim_"))}
              estornos={estornosDe(p)} podeEstornar={gerente} onEstorno={onEstorno} />
          ))}
        </ul>
      )}

      {aberta && podeEnviar && disponivel > 0 && reservadoEmLinks === 0 && (
        <form onSubmit={(e) => { e.preventDefault(); if (gerente && (!integrada || jaPassei)) void pagar(forma); }} className="space-y-3 rounded-xl border border-zinc-200 p-3">
          <label className="block text-xs font-semibold text-zinc-600">
            Valor a cobrar (R$)
            <input className="campo mt-1" inputMode="decimal" disabled={bloqueado} placeholder={centavosParaTexto(disponivel)} value={valor} onChange={(e) => setValor(e.target.value)} aria-label="Valor a cobrar" />
          </label>
          {gerente && maquininha === "stone" && !jaPassei && maquinas.length > 1 && (
            <select className="campo py-1.5 text-sm" disabled={bloqueado} value={serial} onChange={(e) => escolherMaquina(e.target.value)} aria-label="Maquininha">
              {maquinas.map((m) => <option key={m.serial} value={m.serial}>{m.nome}</option>)}
            </select>
          )}
          <p className="text-xs text-zinc-600">
            {posDoBarbeiro ? "Escolha débito ou crédito para enviar o valor à maquininha da barbearia."
              : maquininha === "manual" ? "Integração da maquininha desativada: registre somente valores já recebidos."
              : jaPassei ? "Registro manual de um pagamento já recebido."
              : maquininha === "simulada" ? "Simulação: escolha débito, crédito ou Pix para enviar ao simulador."
              : carregandoMaquinas ? "Carregando maquininhas…"
              : maquinaPronta ? `Escolha débito, crédito ou Pix para cobrar na ${maquinas.find((m) => m.serial === serial)?.nome}.`
              : "Nenhuma maquininha disponível. Confira a configuração antes de cobrar."}
          </p>
          <div className={`grid gap-1.5 ${gerente ? "grid-cols-4" : "grid-cols-2"}`}>
            {formas.map((f) => {
              const Icone = ICONE[f.valor];
              return (
                <button type="button" key={f.valor} disabled={bloqueado || (f.valor !== "DINHEIRO" && maquininha !== "manual" && !jaPassei && !maquinaPronta)}
                  aria-pressed={forma === f.valor}
                  onClick={() => { setForma(f.valor); if (f.valor !== "DINHEIRO" && maquininha !== "manual" && !jaPassei) void pagar(f.valor); }}
                  className={`flex flex-col items-center gap-1 rounded-lg border py-2 text-[11px] font-semibold transition ${forma === f.valor ? "border-ouro bg-ouro/10 text-ouro" : "border-zinc-200 text-zinc-600 hover:border-zinc-400"}`}>
                  <Icone size={16} /> {f.rotulo}
                </button>
              );
            })}
          </div>
          {gerente && (!integrada || jaPassei) && (
            <button className="btn-primario w-full" disabled={bloqueado}>Registrar pagamento recebido</button>
          )}
          {gerente && integrada && (
            <label className="flex items-center gap-2 text-xs text-zinc-500">
              <input type="checkbox" disabled={bloqueado} checked={jaPassei} onChange={(e) => setJaPassei(e.target.checked)} className="accent-[#d3ab45]" />
              Já passei na maquininha (só registrar)
            </label>
          )}
          <p className="text-[11px] text-zinc-500">Em branco = saldo disponível ({reais(disponivel)}). Para dividir, informe o valor antes de escolher a forma.</p>
          {r.aguardando > 0 && <p className="text-xs text-ouro">{gerente ? "Confira ou cancele a cobrança pendente antes de receber o restante." : "Confira a cobrança pendente antes de receber o restante."}</p>}
          {erroLocal && <p role="alert" className="text-xs text-red-700">{erroLocal}</p>}
        </form>
      )}
      {aberta && reservadoEmLinks > 0 && <p className="text-xs text-zinc-500">Há um link de pagamento ativo. Confira ou cancele os links antes de cobrar de outra forma.</p>}
    </div>
  );
}

function LinhaPagamento({ p, aberta, maquininha, podeConferir, podeSimular, podeDesfazer, ocupado, onAcao, estornos, podeEstornar, onEstorno }: {
  p: Pagamento; aberta: boolean; maquininha: ModoMaquininha; podeDesfazer: boolean; ocupado: boolean;
  podeConferir: boolean; podeSimular: boolean;
  onAcao: (id: string, acao: "cancelar" | "conferir" | "simular") => void;
  estornos: EstornoComanda[]; podeEstornar: boolean; onEstorno?: () => void;
}) {
  const Icone = ICONE[p.forma];
  const estornadoTotal = p.status === "CANCELADO" && !!p.estornadoEm;
  const emAberto = estornos.some((e) => e.status === "PENDENTE" || e.status === "APROVADO" || e.status === "FALHOU");
  return (
    <li className={`rounded-xl border p-3 text-sm ${p.status === "AGUARDANDO" ? "border-ouro/50 bg-ouro/5" : "border-zinc-200"}`}>
      <div className="flex items-center gap-2">
        <Icone size={16} className="text-ouro" />
        <span className="font-semibold">{ROTULO_FORMA[p.forma]}</span>
        {p.bandeira && <span className="text-xs text-zinc-500">{p.bandeira}</span>}
        {p.antecipadoId && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">pago online antes</span>}
        {p.linkPagamentoId && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">pago pelo link</span>}
        {estornadoTotal && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700">estornado</span>}
        <span className={`ml-auto font-bold ${estornadoTotal ? "text-zinc-400 line-through" : ""}`}>{reais(p.valorCentavos)}</span>
        {aberta && (p.status === "AGUARDANDO" || podeDesfazer) && (
          <button disabled={ocupado} onClick={() => onAcao(p.id, "cancelar")} className="rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-red-600"
            aria-label={p.status === "AGUARDANDO" ? "Cancelar pagamento" : "Desfazer lançamento errado"} title={p.status === "AGUARDANDO" ? "Cancelar" : "Desfazer lançamento errado (não houve dinheiro)"}>
            <X size={14} />
          </button>
        )}
      </div>
      {p.status === "AGUARDANDO" && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="flex items-center gap-1.5 text-ouro"><LoaderCircle size={13} className="animate-spin" /> {p.gatewayPedidoId ? "Aguardando confirmação do pagamento na maquininha…" : "Envio sem confirmação. Confira a cobrança antes de tentar novamente."}</span>
          <span className="ml-auto flex gap-1.5">
            {maquininha === "simulada" && podeSimular && <button disabled={ocupado} className="btn py-1 text-xs" onClick={() => onAcao(p.id, "simular")}>Simular aprovação</button>}
            {maquininha === "stone" && podeConferir && <button disabled={ocupado} className="btn py-1 text-xs" onClick={() => onAcao(p.id, "conferir")}>Conferir</button>}
          </span>
        </div>
      )}
      {p.status === "PAGO" && p.nsu && <p className="mt-1 text-[11px] text-zinc-500">NSU {p.nsu}</p>}
      {!!p.estornadoCentavos && !estornadoTotal && <p className="mt-1 text-[11px] font-semibold text-red-700">Estornado {reais(p.estornadoCentavos)} (parcial)</p>}
      {estornos.length > 0 && (
        <ul className="mt-2 space-y-1 text-[11px]">
          {estornos.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-1.5"><SeloEstorno status={e.status} /> {reais(e.valorCentavos)} · {e.motivo}
              {e.instrucao && e.status === "MANUAL" && <span className="w-full text-violet-800">{e.instrucao}</span>}
            </li>
          ))}
        </ul>
      )}
      {podeEstornar && (p.status === "PAGO" || !!p.estornadoEm) && (
        <div className="mt-2 flex justify-end empty:hidden"><BotaoEstorno tipo="COMANDA" id={p.id} oculto={p.status !== "PAGO" || emAberto} onFeito={onEstorno} /></div>
      )}
    </li>
  );
}
