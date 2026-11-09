"use client";

import { useRef, useState } from "react";
import { api, paraCentavos } from "@/lib/cliente-api";

export function NovaPessoaRh({ competenciaAtual, competenciaPadrao, aoCriar }: { competenciaAtual: string; competenciaPadrao: string; aoCriar: () => Promise<void> }) {
  const [aberto, setAberto] = useState(false), [ocupado, setOcupado] = useState(false), [erro, setErro] = useState("");
  const tentativa = useRef<{ json: string; id: string } | null>(null);
  async function criar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setErro("");
    const form = e.currentTarget, dados = new FormData(form), salarioCentavos = paraCentavos(String(dados.get("salario") ?? ""));
    if (!Number.isSafeInteger(salarioCentavos) || salarioCentavos < 0) return setErro("Informe um salário válido.");
    const body = { nome: String(dados.get("nome")).trim(), telefone: String(dados.get("telefone")).trim(), cargo: String(dados.get("cargo")).trim(), salarioCentavos, competenciaSalario: String(dados.get("competencia")) };
    const json = JSON.stringify(body);
    if (tentativa.current?.json !== json) tentativa.current = { json, id: crypto.randomUUID() };
    setOcupado(true);
    try {
      await api("/api/rh/funcionarios", { method: "POST", body: { ...body, idempotencia: tentativa.current.id } });
      await aoCriar(); form.reset(); tentativa.current = null; setAberto(false);
    } catch (e) { setErro((e as Error).message); }
    finally { setOcupado(false); }
  }
  return <section className="cartao space-y-3">
    <button className="btn" aria-expanded={aberto} aria-controls="nova-pessoa-rh" onClick={() => setAberto(!aberto)} disabled={ocupado}>Adicionar pessoa somente no RH</button>
    {aberto && <form id="nova-pessoa-rh" className="space-y-3" onSubmit={criar}>
      <p className="text-sm text-zinc-600">Para remuneração sem tarefas de checklist. Não cria login, permissões ou cadeira na agenda.</p>
      <fieldset className="grid gap-3 sm:grid-cols-2" disabled={ocupado}>
        <label className="rotulo">Nome<input className="campo" name="nome" required minLength={2} maxLength={60} autoComplete="name" /></label>
        <label className="rotulo">Telefone com DDD<input className="campo" name="telefone" required minLength={10} maxLength={30} inputMode="tel" autoComplete="tel" /></label>
        <label className="rotulo">Cargo<input className="campo" name="cargo" required minLength={2} maxLength={60} placeholder="Ex.: Sócio" /></label>
        <label className="rotulo">Salário base mensal (R$)<input className="campo" name="salario" required inputMode="decimal" /></label>
        <label className="rotulo">Válido a partir de<input className="campo" name="competencia" type="month" min={competenciaAtual} defaultValue={competenciaPadrao} required /></label>
      </fieldset>
      <p className="text-xs text-zinc-500">O padrão é o próximo mês. Selecione o mês atual para começar agora; folhas anteriores permanecem preservadas.</p>
      {erro && <p role="alert" className="text-sm text-red-700">{erro}</p>}
      <button className="btn-primario" type="submit" disabled={ocupado}>{ocupado ? "Salvando…" : "Criar ficha sem checklist"}</button>
    </form>}
  </section>;
}
