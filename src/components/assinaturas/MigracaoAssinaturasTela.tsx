"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, reais } from "@/lib/cliente-api";
import { ESTADOS_MIGRACAO, ROTULOS_MIGRACAO, type ConferenciaMigracao, type EstadoMigracao } from "@/lib/migracao-assinaturas/schemas";
import type { LinhaMigracao, QuadroMigracao } from "@/lib/migracao-assinaturas/servico";

const VAZIA: ConferenciaMigracao = {
  referencia: "", contratoConciliado: false, rotaVerificada: false, vinculoNovoConfirmado: false,
  legadoInterrompido: false, consentimentoConfirmado: false, proximaCobrancaUnica: false,
};
const CAMPOS: [Exclude<keyof ConferenciaMigracao, "referencia">, string][] = [
  ["contratoConciliado", "Conferi titular, plano, preço, vencimento e período já pago."],
  ["rotaVerificada", "Conferi a rota segura de migração, sem cobrança de período já pago."],
  ["vinculoNovoConfirmado", "Conferi no destino o meio de pagamento e seu vínculo ao titular e contrato corretos."],
  ["legadoInterrompido", "Conferi que a próxima recorrência antiga foi interrompida, preservando o acesso já pago."],
  ["consentimentoConfirmado", "Conferi o consentimento aplicável do titular para a mudança."],
  ["proximaCobrancaUnica", "Conferi data e valor de uma única próxima cobrança nos dois provedores."],
];
const rotulo = (s: string) => ROTULOS_MIGRACAO[s as EstadoMigracao] ?? "Estado desconhecido: revisar";

export function MigracaoAssinaturasTela() {
  const [quadro, setQuadro] = useState<QuadroMigracao | null>(null);
  const [estado, setEstado] = useState("");
  const [responsavel, setResponsavel] = useState("");
  const [cursores, setCursores] = useState<string[]>([]);
  const [revisao, setRevisao] = useState(0);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [selecionada, setSelecionada] = useState<LinhaMigracao | null>(null);
  const [novoEstado, setNovoEstado] = useState<EstadoMigracao>("A_CONFERIR");
  const [destino, setDestino] = useState("");
  const [adiadoAte, setAdiadoAte] = useState("");
  const [conferencia, setConferencia] = useState<ConferenciaMigracao>(VAZIA);
  const cursor = cursores.at(-1) ?? "";

  useEffect(() => {
    let ativo = true;
    const busca = new URLSearchParams();
    if (estado) busca.set("estado", estado);
    if (responsavel) busca.set("responsavelId", responsavel);
    if (cursor) busca.set("cursor", cursor);
    api<QuadroMigracao>(`/api/migracao-assinaturas?${busca}`).then(q => {
      if (ativo) { setQuadro(q); setCarregando(false); }
    }).catch(e => { if (ativo) { setErro(e.message); setCarregando(false); } });
    return () => { ativo = false; };
  }, [estado, responsavel, cursor, revisao]);

  function abrir(linha: LinhaMigracao) {
    setErro(""); setSelecionada(linha); setNovoEstado((linha.migracao?.estado ?? "A_CONFERIR") as EstadoMigracao);
    setDestino(linha.migracao?.destinoGatewayId ?? ""); setAdiadoAte(linha.migracao?.adiadoAte ?? "");
    // Toda nova gravação exige reconferir as evidências, sem caixas já marcadas pela tela.
    setConferencia({ ...VAZIA });
  }
  async function gravar(iniciar: boolean) {
    if (!selecionada) return;
    setSalvando(true); setErro("");
    try {
      const linha = await api<LinhaMigracao>("/api/migracao-assinaturas", { method: "POST", body: iniciar
        ? { acao: "iniciar", assinaturaId: selecionada.assinaturaId }
        : { acao: "atualizar", assinaturaId: selecionada.assinaturaId, versao: selecionada.migracao!.versao,
          contrato: selecionada.contrato, estado: novoEstado, destinoGatewayId: destino || null,
          adiadoAte: novoEstado === "ADIADO" ? adiadoAte || null : null, conferencia } });
      abrir(linha); setCarregando(true); setRevisao(n => n + 1);
    } catch (e) { setErro(e instanceof Error ? e.message : "Não foi possível salvar a conferência."); }
    finally { setSalvando(false); }
  }
  function filtrar(proximoEstado: string, proximoResponsavel: string) {
    setEstado(proximoEstado); setResponsavel(proximoResponsavel); setCursores([]); setSelecionada(null); setErro(""); setCarregando(true);
  }

  return <div className="space-y-5">
    <header className="space-y-2">
      <h1 className="titulo-pagina">Migração de assinaturas</h1>
      <p className="text-sm text-zinc-500">Meta de 20/11/2026, com acompanhamento individual das exceções.</p>
      <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">Este quadro registra conferências da gerência. Salvar não envia mensagens, altera cartões, cancela contratos ou executa cobranças. Nenhum estado representa confirmação automática dos provedores.</p>
      <Link href="/financeiro" className="text-sm underline">Conferir recebimentos e vínculos pendentes no Financeiro</Link>
    </header>
    {erro && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
    {quadro && <>
      <div className="grid gap-3 sm:grid-cols-4">
        {[["Contratos no inventário local", quadro.total], ["Históricos cancelados", quadro.cancelados], ["Sem controle iniciado", quadro.semControle], ["Conferidos como concluídos", quadro.porEstado.CONCLUIDO]].map(([titulo, numero]) =>
          <div key={titulo} className="cartao"><p className="text-xs text-zinc-500">{titulo}</p><p className="text-2xl font-bold">{numero}</p></div>)}
      </div>
      <p className="text-xs text-zinc-500">O inventário inclui contratos cancelados e origens ainda não identificadas. Quantidade de registros não comprova assinantes adimplentes nem migração concluída de toda a base. Pagamentos legados sem contrato local exigem conciliação.</p>
    </>}
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-sm">Etapa<select className="campo mt-1" value={estado} onChange={e => filtrar(e.target.value, responsavel)}>
        <option value="">Todas as etapas</option>{ESTADOS_MIGRACAO.map(e => <option key={e} value={e}>{ROTULOS_MIGRACAO[e]}</option>)}
      </select></label>
      <label className="text-sm">Responsável pela última conferência<select className="campo mt-1" value={responsavel} onChange={e => filtrar(estado, e.target.value)}>
        <option value="">Todos</option>{quadro?.responsaveis.map(r => <option key={r.id} value={r.id}>{r.nome}</option>)}
      </select></label>
      <button type="button" className="btn-secundario" disabled={carregando || salvando} onClick={() => { setCarregando(true); setErro(""); setSelecionada(null); setRevisao(n => n + 1); }}>Atualizar quadro</button>
    </div>
    <p role="status" className="text-sm text-zinc-500">{carregando ? "Consultando inventário…" : `${quadro?.totalFiltrado ?? 0} contrato(s) no filtro. Até 100 por página.`}</p>
    {quadro && <div className="overflow-x-auto rounded-xl border border-zinc-200"><table className="w-full text-left text-sm">
      <thead><tr className="bg-zinc-50"><th className="p-3">Cliente e plano</th><th className="p-3">Contrato</th><th className="p-3">Etapa e pendências</th><th className="p-3">Conferência</th></tr></thead>
      <tbody>{quadro.linhas.map(linha => <tr key={linha.assinaturaId} className="border-t border-zinc-200 align-top">
        <td className="p-3"><p className="font-semibold">{linha.cliente}</p><p>{linha.plano}</p><p className="text-xs text-zinc-500">{linha.status}</p></td>
        <td className="p-3"><p>{reais(linha.contrato.precoCentavos)}</p><p className="text-xs text-zinc-500">Próximo vencimento: {linha.contrato.proximoVencimento ?? "a conferir"}</p></td>
        <td className="p-3"><p>{rotulo(linha.migracao?.estado ?? "A_CONFERIR")}</p>
          {linha.historicoCancelado && <p className="text-xs text-amber-800">Histórico cancelado: não reativar cobrança.</p>}
          {linha.origemNaoIdentificada && <p className="text-xs text-amber-800">Origem legada precisa de conciliação.</p>}
          {linha.contratosVigentesMesmoCliente > 1 && <p className="text-xs text-amber-800">Mais de um contrato vigente: conferir vínculos.</p>}
          {linha.contatoImpedido && <p className="text-xs text-amber-800">Contato automático suspenso.</p>}
          {linha.migracao?.adiadoAte && <p className="text-xs">Revisar em {linha.migracao.adiadoAte}</p>}
        </td>
        <td className="p-3"><button type="button" className="btn-secundario" disabled={carregando || salvando} onClick={() => abrir(linha)}>Conferir contrato</button></td>
      </tr>)}</tbody>
    </table></div>}
    {quadro && <div className="flex gap-2">
      <button type="button" className="btn-secundario" disabled={!cursores.length || carregando || salvando} onClick={() => { setCursores(xs => xs.slice(0, -1)); setSelecionada(null); setCarregando(true); }}>Página anterior</button>
      <button type="button" className="btn-secundario" disabled={!quadro.proximoCursor || carregando || salvando} onClick={() => { setCursores(xs => [...xs, quadro.proximoCursor!]); setSelecionada(null); setCarregando(true); }}>Próxima página</button>
    </div>}
    {selecionada && <section className="cartao space-y-4" aria-label={`Conferência de ${selecionada.cliente}`}>
      <div className="flex flex-wrap justify-between gap-2"><h2 className="text-lg font-bold">{selecionada.cliente} · {selecionada.plano}</h2><button type="button" className="btn-secundario" disabled={salvando} onClick={() => setSelecionada(null)}>Fechar conferência</button></div>
      <p className="text-sm">{reais(selecionada.contrato.precoCentavos)} · vencimento {selecionada.contrato.proximoVencimento ?? "não identificado"} · início do período pago {selecionada.contrato.cicloInicio?.slice(0, 10) ?? "a conciliar"}</p>
      <p className="break-all text-xs text-zinc-500">Origem: {selecionada.migracao?.fonteGatewayId ?? selecionada.gatewayAtual ?? "não identificada"}</p>
      {selecionada.migracao && <p className="text-xs text-zinc-500">Última conferência: {quadro?.responsaveis.find(r => r.id === selecionada.migracao?.responsavelId)?.nome ?? "responsável registrado na auditoria"} · {selecionada.migracao.atualizadoEm.slice(0, 10)}
        {typeof selecionada.migracao.evidencias.referencia === "string" && ` · referência ${selecionada.migracao.evidencias.referencia}`}. Evidência declarada pela gerência.</p>}
      {!selecionada.migracao ? <button type="button" className="btn-primario" disabled={salvando} onClick={() => gravar(true)}>Iniciar controle deste contrato</button>
        : selecionada.migracao.estado === "CONCLUIDO" ? <p className="text-sm">Conferência gerencial concluída. Correções posteriores exigem revisão operacional; este fluxo não reabre o contrato.</p>
        : <form className="space-y-3" onSubmit={e => { e.preventDefault(); void gravar(false); }}>
          <label className="block text-sm">Registrar etapa<select className="campo mt-1" value={novoEstado} onChange={e => setNovoEstado(e.target.value as EstadoMigracao)}>{ESTADOS_MIGRACAO.map(e => <option key={e} value={e}>{ROTULOS_MIGRACAO[e]}</option>)}</select></label>
          <label className="block text-sm">Identificador da assinatura no destino<input className="campo mt-1" value={destino} maxLength={100} placeholder="sub_… ou pixrec_…" onChange={e => setDestino(e.target.value)} /><span className="text-xs text-zinc-500">Somente o ID do contrato; nunca informe cartão, token ou link de pagamento.</span></label>
          {novoEstado === "ADIADO" && <label className="block text-sm">Retomar acompanhamento em<input type="date" className="campo mt-1" required value={adiadoAte} onChange={e => setAdiadoAte(e.target.value)} /></label>}
          <label className="block text-sm">Código da conferência interna<input className="campo mt-1" required minLength={3} maxLength={100} value={conferencia.referencia} placeholder="REV-2026-001" onChange={e => setConferencia(c => ({ ...c, referencia: e.target.value }))} /></label>
          <fieldset className="space-y-2"><legend className="mb-2 font-semibold">Confirmações feitas por você nos documentos e provedores</legend>{CAMPOS.map(([chave, texto]) => <label key={chave} className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={conferencia[chave]} onChange={e => setConferencia(c => ({ ...c, [chave]: e.target.checked }))} />{texto}</label>)}</fieldset>
          <p className="text-xs text-zinc-500">As marcações são uma declaração gerencial auditada, sem consulta automática aos provedores. Avance uma etapa por vez. A conclusão exige todas as conferências e o vínculo efetivo da assinatura ao destino.</p>
          <button type="submit" className="btn-primario" disabled={salvando || carregando}>{salvando ? "Salvando…" : "Salvar conferência gerencial"}</button>
        </form>}
    </section>}
  </div>;
}
