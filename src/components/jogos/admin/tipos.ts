/** Formato das respostas do painel de jogos (as telas importam daqui). */
import type { painelJogos, simularJogo, resultadoJogos, jogadasRecentes } from "@/lib/jogos/painel";
import type { buscarPremios } from "@/lib/jogos/premios";

type Json<T> = T extends Date ? string : T extends (infer U)[] ? Json<U>[] : T extends object ? { [K in keyof T]: Json<T[K]> } : T;

export type Painel = Json<Awaited<ReturnType<typeof painelJogos>>>;
export type JogoPainel = Painel["jogos"][number];
export type PremioPainel = JogoPainel["premios"][number];
export type Simulacao = ReturnType<typeof simularJogo>;
export type Resultado = Json<Awaited<ReturnType<typeof resultadoJogos>>>;
export type JogadaPainel = Json<Awaited<ReturnType<typeof jogadasRecentes>>[number]>;
export type PremioBalcao = Json<Awaited<ReturnType<typeof buscarPremios>>[number]>;
