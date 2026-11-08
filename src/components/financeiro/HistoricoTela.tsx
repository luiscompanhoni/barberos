"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { api, reais } from "@/lib/cliente-api";
import type { ConsultaHistorico, PreviaHistorico } from "@/lib/conciliacao/historico/consulta";
import type { EscolhaHistorico } from "@/lib/conciliacao/historico/schemas";

const URL_API = "/api/financeiro/historico";
const quando = (d: string | null) => d ? new Date(d).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—";
const dia = (d: string) => d.split("-").reverse().join("/");
type ClienteBusca = { id: string; nome: string; telefone: string };

/** Correcao de uma transacao por vez, sempre com evidencia, previa e backup verificado. */
export function HistoricoTela() {
  const [codigo, setCodigo] = useState("");
  const [dados, setDados] = useState<ConsultaHistorico | null>(null);
  const [busca, setBusca] = useState("");
  const [clientes, setClientes] = useState<ClienteBusca[]>([]);
  const [escolha, setEscolha] = useState<EscolhaHistorico | null>(null);
  const [previa, setPrevia] = useState<PreviaHistorico | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState("");
  const emCurso = useRef(false);

  async function tarefa(fn: () => Promise<void>) {
    if (emCurso.current) return;
    emCurso.current = true;
    setOcupado(true); setErro(""); setSucesso("");
    try { await fn(); } catch (e) { setErro((e as Error).message); }
    finally { emCurso.current = false; setOcupado(false); }
  }
  async function consultar(clienteId?: string) {
    setDados(null); setPrevia(null); setEscolha(null); setClientes([]);
    const r = await api<ConsultaHistorico>(`${URL_API}?${new URLSearchParams({ transacaoId: codigo, ...(clienteId ? { clienteId } : {}) })}`);
    setDados(r);
    setEscolha({ transacaoId: r.fonte.id, assinaturaId: "", operacao: "VINCULAR", motivo: "", identidadeConfirmada: false });
  }
  function mudar(campos: Partial<EscolhaHistorico>) {
    setEscolha((e) => e ? { ...e, ...campos } : e); setPrevia(null); setSucesso("");
  }
  const assinatura = dados?.assinaturas.find((a) => a.id === escolha?.assinaturaId);
  const cliente = dados?.candidatos.find((c) => c.id === assinatura?.clienteId);
  const cobrancas = dados?.assinaturas.filter((a) => a.clienteId === assinatura?.clienteId).flatMap((a) => a.cobrancas) ?? [];

  return <section className="min-w-0 space-y-4 [overflow-wrap:anywhere]" aria-labelledby="historico-titulo" aria-busy={ocupado}>
    <div className="cartao space-y-2">
      <h2 id="historico-titulo" className="text-xl font-bold">Corrigir histórico Celcash</h2>
      <p className="text-sm text-zinc-600">Confira uma transação e associe o recebimento à cobrança correta. Uma cobrança ausente pode ser incluída; devoluções já realizadas podem ser registradas com prova no extrato.</p>
      <p className="text-sm text-zinc-600">O estado da assinatura e seus benefícios permanecem como estão. Nenhuma cobrança, transferência ou devolução será enviada à operadora.</p>
      <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); void tarefa(() => consultar()); }}>
        <label className="block text-sm">Código da transação Celcash
          <input className="campo mt-1" name="transacao" inputMode="numeric" spellCheck={false} autoComplete="off" required pattern="[1-9][0-9]{0,14}" value={codigo} disabled={ocupado}
            onChange={(e) => { setCodigo(e.target.value.trim()); setDados(null); setEscolha(null); setPrevia(null); setSucesso(""); }} />
        </label>
        <button className="btn" disabled={ocupado}>{ocupado ? "Conferindo…" : "Consultar transação"}</button>
      </form>
    </div>
    {erro && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-800">{erro}</p>}
    {sucesso && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-emerald-800">{sucesso}</p>}
    {dados && escolha && <>
      <div className="cartao space-y-2">
        <h3 className="font-bold">Origem: Celcash #{dados.fonte.id}</h3>
        <p>{dados.fonte.cliente.nome || "Cliente não informado"} · CPF {dados.fonte.cliente.cpf}</p>
        <p className="text-sm">Telefone: {dados.fonte.cliente.telefones.join(", ") || "Não informado"}</p>
        <p>{reais(dados.fonte.valorCentavos)} · vencimento {dia(dados.fonte.vencimento)} · contrato {dados.fonte.contratoId ?? "Não informado"} · status {dados.fonte.status}</p>
        <p className="text-sm">Data efetiva do pagamento na Celcash: {quando(dados.fonte.pagamentoEfetivoEm ?? null)}</p>
        {dados.vinculo && <p className="text-sm text-emerald-800">Já possui vínculo documentado com a cobrança {dados.vinculo.cobrancaId}.</p>}
        {dados.vinculo?.divergente && <p role="alert" className="text-sm text-amber-900">A sincronização detectou mudança de valor ou status na Celcash após a conciliação. Confira a origem e o extrato antes de gerar uma nova prévia.</p>}
        <h4 className="pt-2 font-semibold">Movimentos no extrato importado</h4>
        {!dados.movimentos.length ? <p className="text-sm">Nenhum crédito ou estorno encontrado. Sincronize a Celcash na área Resultado antes de corrigir.</p>
          : <ul className="space-y-1 text-sm">{dados.movimentos.map((m) => <li key={m.id}>{m.tipo === "RECEBIMENTO" ? "Crédito" : "Estorno"}: {reais(m.valorCentavos)} em {quando(m.data)}</li>)}</ul>}
      </div>
      <fieldset disabled={ocupado} className="cartao space-y-4">
        <legend className="font-bold">Associação no BarberOS</legend>
        <label className="block text-sm">Assinatura de destino
          <select className="campo mt-1 min-w-0 max-w-full" name="assinatura" value={escolha.assinaturaId} onChange={(e) => mudar({ assinaturaId: e.target.value, cobrancaId: undefined, identidadeConfirmada: false })}>
            <option value="">Selecione após conferir o cliente</option>
            {dados.assinaturas.map((a) => <option key={a.id} value={a.id}>{dados.candidatos.find((c) => c.id === a.clienteId)?.nome} · {a.plano} · {a.status} · {a.id}</option>)}
          </select>
        </label>
        {cliente && <p className="text-sm">Cadastro escolhido: {cliente.nome} · {cliente.telefone} · CPF {cliente.cpf}</p>}
        <div className="flex flex-wrap items-end gap-2">
          <label className="block text-sm">Buscar outro cliente por nome ou telefone
            <input className="campo mt-1" name="cliente" autoComplete="off" value={busca} maxLength={60} onChange={(e) => { setBusca(e.target.value); setClientes([]); }} />
          </label>
          <button type="button" className="btn" disabled={busca.trim().length < 2} onClick={() => void tarefa(async () => {
            const r = await api<ClienteBusca[]>(`/api/clientes?${new URLSearchParams({ busca: busca.trim() })}`); setClientes(r);
            if (!r.length) setErro("Nenhum cliente encontrado. Confira o cadastro antes de importar.");
          })}>Buscar cliente</button>
        </div>
        {!!clientes.length && <ul className="space-y-2">{clientes.map((c) => <li key={c.id}><button className="btn" type="button" onClick={() => void tarefa(() => consultar(c.id))}>{c.nome} · {c.telefone}</button></li>)}</ul>}
        <p className="text-xs text-zinc-600">Só aparecem assinaturas existentes. Se o cliente não tiver uma, seu cadastro deve ser conferido antes.</p>
        <label className="block text-sm">Correção
          <select className="campo mt-1" name="operacao" value={escolha.operacao} onChange={(e) => mudar({ operacao: e.target.value as EscolhaHistorico["operacao"], cobrancaId: undefined })}>
            <option value="VINCULAR">Vincular cobrança existente à origem Celcash</option>
            <option value="IMPORTAR">Incluir cobrança histórica ausente</option>
            <option value="ESTORNO">Registrar estorno já realizado na Celcash</option>
          </select>
        </label>
        {escolha.operacao !== "IMPORTAR" && <label className="block text-sm">Cobrança existente do mesmo cliente
          <select className="campo mt-1 min-w-0 max-w-full" name="cobranca" value={escolha.cobrancaId ?? ""} onChange={(e) => mudar({ cobrancaId: e.target.value || undefined })}>
            <option value="">Selecione a cobrança conferida</option>
            {cobrancas.map((c) => <option key={c.id} value={c.id}>{dia(c.vencimento)} · {reais(c.valorCentavos)} · {c.status} · {c.gatewayId}</option>)}
          </select>
        </label>}
        <label className="block text-sm">Evidência e motivo da correção
          <textarea className="campo mt-1" name="motivo" autoComplete="off" rows={3} maxLength={500} value={escolha.motivo} onChange={(e) => mudar({ motivo: e.target.value })} placeholder="Ex.: conferi contrato, titular, valor e datas nos comprovantes…" />
        </label>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={escolha.identidadeConfirmada} onChange={(e) => mudar({ identidadeConfirmada: e.target.checked })} />Conferi a identidade do cliente e confirmo a associação mesmo se nome, CPF ou telefone divergirem. Registrei a evidência no motivo.</label>
        <button className="btn" type="button" disabled={!escolha.assinaturaId || escolha.motivo.trim().length < 10 || (escolha.operacao !== "IMPORTAR" && !escolha.cobrancaId)} onClick={() => void tarefa(async () => {
          setPrevia(null); setPrevia(await api<PreviaHistorico>(URL_API, { method: "POST", body: { acao: "prever", escolha } }));
        })}>Conferir prévia</button>
      </fieldset>
      {previa && <div className="cartao space-y-3" aria-live="polite">
        <h3 className="font-bold">Prévia para {previa.cliente.nome}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><h4 className="font-semibold">Antes</h4>{previa.antes ? <p className="text-sm">{reais(previa.antes.valorCentavos)} · {dia(previa.antes.vencimento)} · {previa.antes.status}<br />Pagamento: {quando(previa.antes.pagaEm)}<br />Assinatura: {previa.antes.assinaturaId}</p> : <p className="text-sm">Inclusão de cobrança ausente</p>}</div>
          <div><h4 className="font-semibold">Depois</h4><p className="text-sm">{reais(previa.depois.valorCentavos)} · {dia(previa.depois.vencimento)} · {previa.depois.status}<br />Pagamento: {quando(previa.depois.pagaEm)}<br />Assinatura: {previa.depois.assinaturaId}</p>
            {previa.depois.estornoEm && <p className="text-sm">Devolução registrada em {quando(previa.depois.estornoEm)}</p>}</div>
        </div>
        <p className="text-sm">Data efetiva do recebimento: {quando(previa.depois.pagamentoEfetivoEm)}{previa.depois.recebimentoComprovado ? " · Valor e data do recebimento comprovados." : " · Receita permanece pendente de comprovação."}</p>
        {previa.avisos.map((a) => <p key={a} className="text-sm text-amber-900">{a}</p>)}
        {previa.bloqueios.map((a) => <p key={a} className="text-sm text-red-800">{a}</p>)}
        <p className="text-sm">{previa.backup?.apto ? `Backup conferido em ${quando(previa.backup.criadoEm)} · ${previa.backup.conferencia ?? "Restauração validada"}` : "Aplicação bloqueada: é necessário um backup com restauração conferida nas últimas duas horas. Solicite o backup ao responsável pelo servidor e gere uma nova prévia."} <Link className="underline" href="/configuracoes">Ver configurações</Link></p>
        <button className="btn-primario" type="button" disabled={ocupado || !previa.podeAplicar} onClick={() => void tarefa(async () => {
          const r = await api<{ cobrancaId: string; repetida: boolean; recebimentoComprovado: boolean; recebimentoPendente: string | null }>(URL_API, { method: "POST", body: { acao: "aplicar", escolha: { ...escolha, revisao: previa.revisao, backupId: previa.backup!.id } } });
          setPrevia(null); setDados(null); setEscolha(null);
          setSucesso(`${r.repetida ? "Correção já registrada" : "Correção registrada com auditoria"}. Cobrança ${r.cobrancaId}. ${r.recebimentoComprovado ? "Recebimento com valor e data comprovados." : r.recebimentoPendente ?? "O recebimento permanece sem prova monetária."} Consulte a transação novamente para conferir o vínculo.`);
        })}>{ocupado ? "Aplicando…" : "Aplicar correção histórica"}</button>
      </div>}
    </>}
  </section>;
}
