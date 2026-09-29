"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/cliente-api";
import { dataLocal } from "@/lib/agenda/tempo";
import { Excecoes, type ExcecaoApi } from "./Excecoes";
import { FecharAgenda, type BloqueioApi } from "./FecharAgenda";
import { SemanaPadrao } from "./SemanaPadrao";

type Config = {
  id: string;
  nome: string;
  expediente: { diaSemana: number; inicioMin: number; fimMin: number }[];
  excecoes: ExcecaoApi[];
  bloqueios: BloqueioApi[];
};

/** Horarios do barbeiro. O dono escolhe de quem; o barbeiro so ve o proprio. */
export function ExpedienteTela(p: { barbeiros: { id: string; nome: string }[]; inicial: string }) {
  const [barbeiroId, setBarbeiroId] = useState(p.inicial);
  const [cfg, setCfg] = useState<Config | null>(null);
  const [erro, setErro] = useState("");
  const [hoje] = useState(() => dataLocal(Date.now(), "America/Sao_Paulo"));

  const carregar = useCallback(() => {
    api<Config>(`/api/barbeiros/${barbeiroId}/agenda`)
      .then((c) => { setCfg(c); setErro(""); })
      .catch((e) => setErro(e.message));
  }, [barbeiroId]);
  useEffect(carregar, [carregar]);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold">Horários {cfg ? `de ${cfg.nome}` : ""}</h1>
        {p.barbeiros.length > 1 && (
          <select className="campo ml-auto w-auto" value={barbeiroId} onChange={(e) => { setBarbeiroId(e.target.value); setCfg(null); }}>
            {p.barbeiros.map((b) => <option key={b.id} value={b.id}>{b.nome}</option>)}
          </select>
        )}
      </div>
      {erro && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
      {cfg && (
        <>
          {/* key força recarregar o formulario ao trocar de barbeiro */}
          <SemanaPadrao key={cfg.id} barbeiroId={cfg.id} inicial={cfg.expediente} onSalvo={carregar} />
          <Excecoes barbeiroId={cfg.id} excecoes={cfg.excecoes} hoje={hoje} onSalvo={carregar} />
          <FecharAgenda barbeiroId={cfg.id} bloqueios={cfg.bloqueios} hoje={hoje} onSalvo={carregar} />
        </>
      )}
    </div>
  );
}
