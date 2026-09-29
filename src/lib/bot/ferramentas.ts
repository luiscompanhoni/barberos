import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { db } from "@/lib/db";
import { ErroNegocio } from "@/lib/erros";
import { configuracao } from "@/lib/agenda/carregar";
import { horariosDisponiveis } from "@/lib/agenda/consultas";
import { agendarPeloCliente, cancelarPeloCliente, proximosDoCliente, remarcarPeloCliente } from "@/lib/agenda/cliente";
import { dataLocal, hhmmParaMin, instanteLocal, minParaHhmm, minutosLocal, parseData, somarDias } from "@/lib/agenda/tempo";

/** Quem esta conversando: o bot so enxerga e altera os dados deste telefone. */
export type ContextoBot = {
  conversaId: string;
  telefone: string;
  nomePerfil: string | null;
};

type Ferramenta = Anthropic.Beta.BetaTool;

export const FERRAMENTAS: Ferramenta[] = [
  {
    name: "listar_servicos",
    description: "Lista os serviços da barbearia com preço, duração e quais barbeiros fazem cada um.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "consultar_horarios",
    description:
      "Horários livres para um serviço numa data. Sem barbeiro_id, traz os horários de todos os barbeiros que fazem o serviço. Use sempre antes de oferecer horários.",
    input_schema: {
      type: "object",
      properties: {
        data: { type: "string", description: "Data no formato AAAA-MM-DD" },
        servico_id: { type: "string" },
        barbeiro_id: { type: "string", description: "Opcional: só esse barbeiro" },
      },
      required: ["data", "servico_id"],
      additionalProperties: false,
    },
  },
  {
    name: "agendar",
    description:
      "Marca o horário para o cliente desta conversa. Só chame depois que o cliente confirmar serviço, barbeiro, data e hora.",
    input_schema: {
      type: "object",
      properties: {
        servico_id: { type: "string" },
        barbeiro_id: { type: "string" },
        data: { type: "string", description: "AAAA-MM-DD" },
        horario: { type: "string", description: "HH:MM (24h)" },
        nome_cliente: { type: "string", description: "Nome do cliente, obrigatório se ele ainda não tem cadastro" },
        qualquer_barbeiro: { type: "boolean", description: "true se o cliente disse que tanto faz o barbeiro" },
      },
      required: ["servico_id", "barbeiro_id", "data", "horario"],
      additionalProperties: false,
    },
  },
  {
    name: "meus_agendamentos",
    description: "Próximos horários marcados do cliente desta conversa (com o id de cada um).",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "cancelar_agendamento",
    description: "Cancela um horário do cliente. Só chame depois que ele confirmar qual horário quer cancelar.",
    input_schema: {
      type: "object",
      properties: { agendamento_id: { type: "string" } },
      required: ["agendamento_id"],
      additionalProperties: false,
    },
  },
  {
    name: "remarcar_agendamento",
    description:
      "Muda data/hora (e opcionalmente o barbeiro) de um horário do cliente, mantendo o serviço. Consulte os horários livres antes e confirme com o cliente.",
    input_schema: {
      type: "object",
      properties: {
        agendamento_id: { type: "string" },
        data: { type: "string", description: "AAAA-MM-DD" },
        horario: { type: "string", description: "HH:MM (24h)" },
        barbeiro_id: { type: "string", description: "Opcional: trocar de barbeiro" },
      },
      required: ["agendamento_id", "data", "horario"],
      additionalProperties: false,
    },
  },
  {
    name: "salvar_nome",
    description: "Salva ou corrige o nome do cliente desta conversa.",
    input_schema: {
      type: "object",
      properties: { nome: { type: "string" } },
      required: ["nome"],
      additionalProperties: false,
    },
  },
  {
    name: "chamar_atendente",
    description:
      "Passa a conversa para uma pessoa da equipe (o bot para de responder). Use quando o cliente pedir, reclamar, ou o assunto fugir de agendamentos e informações da barbearia.",
    input_schema: {
      type: "object",
      properties: { motivo: { type: "string" } },
      required: ["motivo"],
      additionalProperties: false,
    },
  },
];

const zData = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const zHora = z.string().regex(/^\d{1,2}:\d{2}$/);
const ENTRADAS = {
  consultar_horarios: z.object({ data: zData, servico_id: z.string(), barbeiro_id: z.string().optional() }),
  agendar: z.object({ servico_id: z.string(), barbeiro_id: z.string(), data: zData, horario: zHora, nome_cliente: z.string().optional(), qualquer_barbeiro: z.boolean().optional() }),
  cancelar_agendamento: z.object({ agendamento_id: z.string() }),
  remarcar_agendamento: z.object({ agendamento_id: z.string(), data: zData, horario: zHora, barbeiro_id: z.string().optional() }),
  salvar_nome: z.object({ nome: z.string().trim().min(2).max(60) }),
  chamar_atendente: z.object({ motivo: z.string().max(300) }),
};

const reais = (c: number) => `R$ ${(c / 100).toFixed(2).replace(".", ",")}`;

function descreverData(data: string) {
  const { ano, mes, dia } = parseData(data);
  const ds = new Date(Date.UTC(ano, mes - 1, dia)).toLocaleDateString("pt-BR", { weekday: "long", timeZone: "UTC" });
  return `${ds} ${String(dia).padStart(2, "0")}/${String(mes).padStart(2, "0")}`;
}

export type ResultadoFerramenta = { texto: string; erro?: boolean; passouParaHumano?: boolean };

/** Executa uma ferramenta; erros de regra viram texto para o modelo explicar ao cliente. */
export async function executarFerramenta(nome: string, entrada: unknown, ctx: ContextoBot): Promise<ResultadoFerramenta> {
  try {
    return await executar(nome, entrada, ctx);
  } catch (e) {
    if (e instanceof ErroNegocio) return { texto: e.message, erro: true };
    if (e instanceof z.ZodError) return { texto: `Parametros inválidos: ${e.issues.map((i) => i.path.join(".")).join(", ")}`, erro: true };
    console.error(`[bot] ferramenta ${nome} falhou:`, e);
    return { texto: "Erro interno ao executar a ação. Peça desculpas e ofereça chamar um atendente.", erro: true };
  }
}

async function clienteDaConversa(ctx: ContextoBot) {
  return db.cliente.findUnique({ where: { telefone: ctx.telefone } });
}

async function executar(nome: string, entrada: unknown, ctx: ContextoBot): Promise<ResultadoFerramenta> {
  const cfg = await configuracao();
  switch (nome) {
    case "listar_servicos": {
      const servicos = await db.servico.findMany({
        where: { ativo: true },
        orderBy: [{ ordem: "asc" }, { nome: "asc" }],
        include: { barbeiros: { where: { barbeiro: { ativo: true } }, include: { barbeiro: { select: { id: true, nome: true } } } } },
      });
      return {
        texto: JSON.stringify(
          servicos
            .filter((s) => s.barbeiros.length)
            .map((s) => ({
              servico_id: s.id,
              nome: s.nome,
              preco: reais(s.precoCentavos),
              duracao_min: s.duracaoMin,
              barbeiros: s.barbeiros.map((b) => ({ barbeiro_id: b.barbeiro.id, nome: b.barbeiro.nome })),
            })),
        ),
      };
    }
    case "consultar_horarios": {
      const e = ENTRADAS.consultar_horarios.parse(entrada);
      const hoje = dataLocal(Date.now(), cfg.fuso);
      if (e.data < hoje) return { texto: "Essa data já passou.", erro: true };
      if (e.data > somarDias(hoje, cfg.janelaAgendamentoDias)) {
        return { texto: `Só da para agendar até ${cfg.janelaAgendamentoDias} dias à frente.`, erro: true };
      }
      const r = await horariosDisponiveis({ data: e.data, servicoId: e.servico_id, barbeiroId: e.barbeiro_id, paraCliente: true });
      if (!r.length) return { texto: "Nenhum barbeiro faz esse serviço (confira o servico_id em listar_servicos).", erro: true };
      return {
        texto: JSON.stringify({
          data: descreverData(e.data),
          barbeiros: r.map((b) => ({
            barbeiro_id: b.barbeiroId,
            nome: b.nome,
            preco: reais(b.precoCentavos),
            duracao_min: b.duracaoMin,
            horarios: b.horarios.map((h) => minParaHhmm(minutosLocal(Date.parse(h), cfg.fuso))),
          })),
        }),
      };
    }
    case "agendar": {
      const e = ENTRADAS.agendar.parse(entrada);
      const cliente = await clienteDaConversa(ctx);
      const nome = cliente?.nome.trim() || e.nome_cliente?.trim();
      if (!nome) return { texto: "Cliente sem cadastro: pergunte o nome dele antes de agendar.", erro: true };
      const inicio = new Date(instanteLocal(e.data, hhmmParaMin(e.horario), cfg.fuso));
      if (cliente && !cliente.nome.trim()) await db.cliente.update({ where: { id: cliente.id }, data: { nome } });
      const ag = await agendarPeloCliente({
        telefone: ctx.telefone, nome, barbeiroId: e.barbeiro_id, servicoId: e.servico_id, inicio, origem: "BOT", semPreferencia: e.qualquer_barbeiro,
      });
      await ligarConversaAoCliente(ctx);
      const det = await db.agendamento.findUniqueOrThrow({
        where: { id: ag.id },
        include: { barbeiro: { select: { nome: true } }, servico: { select: { nome: true } } },
      });
      return {
        texto: `Agendado. id=${det.id}; ${det.servico.nome} com ${det.barbeiro.nome}, ${descreverData(e.data)} às ${e.horario}; ${reais(det.precoCentavos)}.`,
      };
    }
    case "meus_agendamentos": {
      const cliente = await clienteDaConversa(ctx);
      if (!cliente) return { texto: "Cliente ainda não tem cadastro nem horários marcados." };
      const lista = await proximosDoCliente(cliente.id);
      if (!lista.length) return { texto: "Nenhum horário marcado." };
      return {
        texto: JSON.stringify(
          lista.map((a) => ({
            agendamento_id: a.id,
            servico: a.servico.nome,
            barbeiro: a.barbeiro.nome,
            data: descreverData(dataLocal(a.inicio, cfg.fuso)),
            horario: minParaHhmm(minutosLocal(a.inicio, cfg.fuso)),
          })),
        ),
      };
    }
    case "cancelar_agendamento": {
      const e = ENTRADAS.cancelar_agendamento.parse(entrada);
      const cliente = await clienteDaConversa(ctx);
      if (!cliente) return { texto: "Cliente sem horários marcados.", erro: true };
      await cancelarPeloCliente(cliente.id, e.agendamento_id);
      return { texto: "Cancelado." };
    }
    case "remarcar_agendamento": {
      const e = ENTRADAS.remarcar_agendamento.parse(entrada);
      const cliente = await clienteDaConversa(ctx);
      if (!cliente) return { texto: "Cliente sem horários marcados.", erro: true };
      const inicio = new Date(instanteLocal(e.data, hhmmParaMin(e.horario), cfg.fuso));
      const n = await remarcarPeloCliente(cliente.id, e.agendamento_id, inicio, e.barbeiro_id);
      const b = await db.barbeiro.findUniqueOrThrow({ where: { id: n.barbeiroId }, select: { nome: true } });
      return { texto: `Remarcado para ${descreverData(e.data)} às ${e.horario} com ${b.nome}.` };
    }
    case "salvar_nome": {
      const e = ENTRADAS.salvar_nome.parse(entrada);
      await db.cliente.upsert({ where: { telefone: ctx.telefone }, create: { telefone: ctx.telefone, nome: e.nome }, update: { nome: e.nome } });
      await ligarConversaAoCliente(ctx);
      return { texto: `Nome salvo: ${e.nome}.` };
    }
    case "chamar_atendente": {
      const e = ENTRADAS.chamar_atendente.parse(entrada);
      await db.conversa.update({ where: { id: ctx.conversaId }, data: { estado: "HUMANO" } });
      await db.mensagem.create({ data: { conversaId: ctx.conversaId, autor: "NOTA", texto: `Bot pediu atendente: ${e.motivo}` } });
      return { texto: "Conversa passada para a equipe. Avise o cliente que alguém vai responder em breve.", passouParaHumano: true };
    }
    default:
      return { texto: `Ferramenta desconhecida: ${nome}`, erro: true };
  }
}

async function ligarConversaAoCliente(ctx: ContextoBot) {
  const c = await db.cliente.findUnique({ where: { telefone: ctx.telefone }, select: { id: true } });
  if (c) await db.conversa.update({ where: { id: ctx.conversaId }, data: { clienteId: c.id } });
}
