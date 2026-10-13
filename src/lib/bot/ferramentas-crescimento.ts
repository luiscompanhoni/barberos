/**
 * Ferramentas do bot para lista de espera de horario e indicacao.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { configuracao } from "@/lib/agenda/carregar";
import { entrarNaEspera, esperasDoCliente } from "@/lib/crescimento/espera";
import { painelDeIndicacao, registrarIndicacao } from "@/lib/crescimento/indicacao";
import { db } from "@/lib/db";
import type { ContextoBot, ResultadoFerramenta } from "./ferramentas";

const reais = (c: number) => `R$ ${(c / 100).toFixed(2).replace(".", ",")}`;

export const FERRAMENTAS_CRESCIMENTO: Anthropic.Beta.BetaTool[] = [
  {
    name: "avisar_quando_abrir",
    description:
      "Coloca o cliente na lista de espera de um dia sem horário livre: se alguém cancelar, ele recebe as opções aqui no WhatsApp. Use quando não houver vaga no dia que ele quer e ele aceitar esperar.",
    input_schema: {
      type: "object",
      properties: {
        data: { type: "string", description: "AAAA-MM-DD" },
        servico_id: { type: "string" },
        barbeiro_id: { type: "string", description: "Opcional: só com esse barbeiro" },
        periodo: { type: "string", enum: ["QUALQUER", "MANHA", "TARDE", "NOITE"] },
      },
      required: ["data", "servico_id"],
      additionalProperties: false,
    },
  },
  {
    name: "meu_link_indicacao",
    description: "Link e código “indique e ganhe” do cliente, com o prêmio de cada lado e quantos amigos ele já trouxe.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "usar_codigo_indicacao",
    description: "Registra que este cliente novo veio indicado por alguém (código que o amigo passou). Só para quem ainda não cortou aqui.",
    input_schema: {
      type: "object",
      properties: { codigo: { type: "string" } },
      required: ["codigo"],
      additionalProperties: false,
    },
  },
];

export const NOMES_CRESCIMENTO = new Set(FERRAMENTAS_CRESCIMENTO.map((f) => f.name));

const ENTRADAS = {
  avisar_quando_abrir: z.object({ data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), servico_id: z.string(), barbeiro_id: z.string().optional(), periodo: z.enum(["QUALQUER", "MANHA", "TARDE", "NOITE"]).optional() }),
  usar_codigo_indicacao: z.object({ codigo: z.string().max(20) }),
};

export async function executarCrescimento(nome: string, entrada: unknown, ctx: ContextoBot): Promise<ResultadoFerramenta> {
  const cliente = await db.cliente.findUnique({ where: { telefone: ctx.telefone }, select: { id: true } });
  switch (nome) {
    case "avisar_quando_abrir": {
      const e = ENTRADAS.avisar_quando_abrir.parse(entrada);
      if (!cliente) return { texto: "Cliente sem cadastro: pergunte o nome e salve com salvar_nome antes.", erro: true };
      await entrarNaEspera(cliente.id, { data: e.data, servicoId: e.servico_id, barbeiroId: e.barbeiro_id, periodo: e.periodo, origem: "BOT" });
      const ativas = await esperasDoCliente(cliente.id);
      return { texto: `Na lista de espera. Esperas ativas do cliente: ${JSON.stringify(ativas)}. Avise que ele recebe aqui as opções se abrir vaga (quem responder primeiro fica).` };
    }
    case "meu_link_indicacao": {
      if (!cliente) return { texto: "Cliente sem cadastro: pergunte o nome e salve com salvar_nome antes.", erro: true };
      const p = await painelDeIndicacao(cliente.id);
      if (!p.ativa) return { texto: "A barbearia não tem programa de indicação ativo no momento." };
      return {
        texto: JSON.stringify({
          link: p.link, codigo: p.codigo,
          premio_de_quem_indica: reais(p.premioIndicadorCentavos), premio_do_amigo: reais(p.premioIndicadoCentavos),
          amigos_indicados: p.indicados, amigos_que_ja_vieram: p.convertidos,
          descontos_disponiveis: p.beneficios.map((b) => `${b.descricao}: ${reais(b.valorCentavos)}`),
          mensagem_pronta_para_encaminhar: p.convite,
        }),
      };
    }
    case "usar_codigo_indicacao": {
      const e = ENTRADAS.usar_codigo_indicacao.parse(entrada);
      if (!cliente) return { texto: "Cliente sem cadastro: pergunte o nome e salve com salvar_nome antes.", erro: true };
      const r = await registrarIndicacao(cliente.id, e.codigo, "BOT");
      const cfg = await configuracao();
      return { texto: `Indicação registrada: indicado por ${r.indicador.nome.split(" ")[0]}.${r.premioCentavos ? ` Ele ganhou ${reais(r.premioCentavos)} de desconto no primeiro atendimento na ${cfg.nomeBarbearia} (sai na comanda).` : ""}` };
    }
    default:
      return { texto: `Ferramenta desconhecida: ${nome}`, erro: true };
  }
}
