"use client";

import { createContext, useContext } from "react";
import type { Permissoes } from "@/lib/auth/permissoes-regras";

/** Papel e permissoes de quem esta logado (para esconder o que a pessoa nao pode fazer; o servidor confere de novo). */
export type Acesso = { papel: string; permissoes: Permissoes };

const Contexto = createContext<Acesso | null>(null);

export function AcessoProvider({ valor, children }: { valor: Acesso; children: React.ReactNode }) {
  return <Contexto value={valor}>{children}</Contexto>;
}

const NENHUMA = { estorno: false, desconto: false, saldo: false, assinatura: false, caixa: false, comissao: false, folha: false, excluir: false, resultado: false, lucro: false, reunioes: false, comissoes_equipe: false, avaliar_equipe: false, duracao: false, bloquear_agenda: false } satisfies Permissoes;

export function useAcesso(): Acesso {
  return useContext(Contexto) ?? { papel: "", permissoes: NENHUMA };
}
