"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { api, reais } from "@/lib/cliente-api";

type Proposta = { planoId: string; precoCentavos: number; limiteUsos: number; termosVersao: string };

export function AdesaoDezembro({ proposta }: { proposta: Proposta }) {
  const router = useRouter();
  const chave = useRef<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [concluida, setConcluida] = useState(false);
  const [erro, setErro] = useState("");

  async function aderir(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (enviando || concluida) return;
    const dados = new FormData(e.currentTarget);
    chave.current ??= crypto.randomUUID();
    setEnviando(true);
    setErro("");
    try {
      await api("/api/cliente/oferta-dezembro", {
        method: "POST",
        body: {
          ...proposta, chave: chave.current, forma: "CARTAO",
          cartaoToken: dados.get("cartao"), aceitaTermos: dados.get("aceite") === "on",
        },
      });
      setConcluida(true);
      router.refresh();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form className="cartao space-y-4" onSubmit={aderir}>
      <div className="space-y-2">
        <label className="block text-sm font-semibold" htmlFor="cartao-dezembro">Cartão de crédito de teste</label>
        <select id="cartao-dezembro" name="cartao" className="campo min-h-11 w-full" defaultValue="" required disabled={enviando || concluida}>
          <option value="" disabled>Selecione um cartão</option>
          <option value="dezembro_cartao_aprovado">Cartão de teste aprovado</option>
          <option value="dezembro_cartao_recusado">Cartão de teste recusado</option>
        </select>
      </div>
      <label className="flex min-h-11 items-start gap-3 text-sm">
        <input type="checkbox" name="aceite" required disabled={enviando || concluida} className="mt-0.5 size-5 shrink-0 accent-zinc-900" />
        <span>Li e aceito o termo de adesão da oferta e a recorrência mensal prevista a partir de 01/01/2027.</span>
      </label>
      {erro && <p role="alert" className="text-sm text-red-700">{erro}</p>}
      <button type="submit" className="btn-primario min-h-11 w-full" disabled={enviando || concluida}>
        {enviando ? "Confirmando…" : concluida ? "Adesão confirmada" : "Confirmar adesão simulada"}
      </button>
    </form>
  );
}

export function CancelamentoDezembro({ multaCentavos, agendado, fimFidelidade }: { multaCentavos: number; agendado: boolean; fimFidelidade: string }) {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState("");

  async function cancelar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (enviando || sucesso) return;
    const dados = new FormData(e.currentTarget);
    setEnviando(true);
    setErro("");
    try {
      await api("/api/cliente/oferta-dezembro", { method: "PATCH", body: { quando: dados.get("quando") } });
      setSucesso("Cancelamento registrado.");
      router.refresh();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <details className="cartao">
      <summary className="cursor-pointer py-2 font-semibold">Cancelar contrato</summary>
      <form className="space-y-4 pt-3" onSubmit={cancelar}>
        <fieldset className="space-y-3 text-sm" disabled={enviando || !!sucesso}>
          <legend className="mb-2 font-medium">Quando quer encerrar?</legend>
          <label className="flex min-h-11 items-start gap-2">
            <input name="quando" value="agora" type="radio" required className="mt-0.5 size-5 shrink-0 accent-zinc-900" />
            <span>Agora, com multa simulada de {reais(multaCentavos)}. Horários futuros sem comanda passam a ser avulsos.</span>
          </label>
          {!agendado && <label className="flex min-h-11 items-start gap-2">
            <input name="quando" value="fim_fidelidade" type="radio" required className="mt-0.5 size-5 shrink-0 accent-zinc-900" />
            <span>Ao fim da fidelidade, em {fimFidelidade}, com multa simulada de {reais(0)}.</span>
          </label>}
        </fieldset>
        {erro && <p role="alert" className="text-sm text-red-700">{erro}</p>}
        {sucesso && <p role="status" className="text-sm">{sucesso}</p>}
        <button type="submit" className="btn min-h-11 w-full" disabled={enviando || !!sucesso}>
          {enviando ? "Registrando…" : "Registrar cancelamento"}
        </button>
      </form>
    </details>
  );
}
