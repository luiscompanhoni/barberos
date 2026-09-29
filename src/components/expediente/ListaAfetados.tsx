"use client";

import { formatarTelefone } from "@/lib/telefone";

export type Afetado = {
  id: string;
  inicio: string;
  cliente: { nome: string; telefone: string };
  servico: { nome: string };
};

const quando = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo",
  });

/** Clientes marcados que ficaram fora do novo horario: o sistema nao cancela sozinho. */
export function ListaAfetados({ afetados }: { afetados: Afetado[] }) {
  if (!afetados.length) return null;
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
      <p className="font-medium text-amber-900">
        {afetados.length} cliente(s) marcado(s) ficaram fora do novo horário. Remarque pela agenda (arrastando) ou avise o cliente:
      </p>
      <ul className="mt-2 space-y-1 text-amber-900">
        {afetados.map((a) => (
          <li key={a.id}>
            {quando(a.inicio)} · <b>{a.cliente.nome}</b> · {a.servico.nome} ·{" "}
            <a className="underline" href={`https://wa.me/${a.cliente.telefone}`} target="_blank" rel="noreferrer">
              {formatarTelefone(a.cliente.telefone)}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
