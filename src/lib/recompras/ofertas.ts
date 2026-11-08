import type { z } from "zod";
import { db } from "@/lib/db";
import { auditar } from "@/lib/auditoria";
import { exigirGestaoBarbeiro, type Sessao } from "@/lib/auth/sessao";
import { exigirPermissao } from "@/lib/auth/permissoes";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { configuracao, STATUS_ATIVOS } from "@/lib/agenda/carregar";
import { dataLocal } from "@/lib/agenda/tempo";
import { travarBarbeiro, validarEncaixe } from "@/lib/agenda/agendamentos";
import { validarCadeira } from "@/lib/agenda/cadeiras";
import { precificar } from "@/lib/assinaturas/agenda";
import { descricaoServico } from "@/lib/comandas/regras";
import { publicar } from "@/lib/eventos";
import { schemaOferta } from "./schemas";
import { oportunidadesDoDia } from "./servico";
import { ultimasCompras } from "./historico";
import { descontoReativacao, diasDecorridos, DIA } from "./regras";
import { escolherRegra, adicionalNoDia, calcularComissao } from "@/lib/rh/regras";
import { extrasNaCompetencia, regrasServicosNaCompetencia } from "@/lib/rh/config-calculo";

export async function registrarOferta(s: Sessao, input: z.infer<typeof schemaOferta>) {
  const principal = await db.agendamento.findUnique({ where: { id: input.agendamentoId } });
  if (!principal) throw naoEncontrado("Atendimento");
  exigirGestaoBarbeiro(s, principal.barbeiroId);
  if (input.aplicarDesconto) await exigirPermissao(s, "desconto");
  const cfg = await configuracao();
  const dia = dataLocal(principal.inicio, cfg.fuso);
  const chave = { agendamentoId: principal.id, servicoId: input.servicoId };
  const existente = await db.ofertaRecompra.findUnique({ where: { agendamentoId_servicoId: chave } });
  if (existente?.estado === "ACEITOU") {
    if (input.estado !== "ACEITOU") throw new ErroNegocio("A oferta já virou atendimento. Cancele pela agenda, se necessário.", 409);
    return existente;
  }
  const oportunidade = (await oportunidadesDoDia(principal.barbeiroId, dia)).find(o => o.agendamentoId === principal.id && o.servicoId === input.servicoId);
  if (!oportunidade) throw new ErroNegocio("A oportunidade não está mais disponível. Atualize o dia.", 409);
  if (input.estado === "LEMBRAR" && (!input.lembrarEm || +input.lembrarEm <= Date.now())) throw new ErroNegocio("Escolha uma data futura para lembrar.");
  if (input.estado === "ACEITOU" && !oportunidade.podeEncaixar) throw new ErroNegocio("Não há tempo livre após esse atendimento. Escolha um encaixe pela agenda.", 409);
  if (input.aplicarDesconto && oportunidade.descontoCentavos <= 0) throw new ErroNegocio("Esta oportunidade não tem desconto autorizado e vigente.");

  const resultado = await db.$transaction(async tx => {
    await travarBarbeiro(tx, principal.barbeiroId);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`recompra:${principal.clienteId}`}))`;
    const atual = await tx.agendamento.findUniqueOrThrow({ where: { id: principal.id }, include: { itemComanda: true, barbeiro: true } });
    const registrada = await tx.ofertaRecompra.findUnique({ where: { agendamentoId_servicoId: chave } });
    if (registrada?.estado === "ACEITOU") return registrada;
    if (!atual.barbeiro.ativo) throw new ErroNegocio("O profissional está inativo.", 409);
    if (!(STATUS_ATIVOS as readonly string[]).includes(atual.status) || atual.barbeiroId !== principal.barbeiroId || +atual.fim !== +principal.fim) throw new ErroNegocio("O atendimento foi alterado. Atualize o dia.", 409);
    const historico = await ultimasCompras([atual.clienteId], atual.inicio, tx);
    if (historico.ultimas.get(`${atual.clienteId}:${input.servicoId}`)?.fim.toISOString() !== oportunidade.ultimaEm) throw new ErroNegocio("O histórico do cliente mudou. Atualize a recomendação.", 409);
    const outraOferta = await tx.ofertaRecompra.findFirst({ where: { clienteId: atual.clienteId, servicoId: input.servicoId, ultimaEm: new Date(oportunidade.ultimaEm), estado: { in: ["ACEITOU", "RECUSOU"] } } });
    if (outraOferta) throw new ErroNegocio("Essa oportunidade já foi resolvida.", 409);
    let novoAgendamentoId: string | null = null;
    if (input.estado === "ACEITOU") {
      const servico = await tx.servico.findUniqueOrThrow({ where: { id: input.servicoId }, include: { barbeiros: { where: { barbeiroId: atual.barbeiroId } } } });
      const sb = servico.barbeiros[0];
      if (!servico.ativo || !sb) throw new ErroNegocio("Serviço indisponível para esse profissional.");
      const inicio = +atual.fim + cfg.intervaloEntreClientes * 60_000;
      const int = { inicio, fim: inicio + (sb.duracaoMin ?? servico.duracaoMin) * 60_000 };
      if (new Date(inicio).toISOString() !== oportunidade.inicioSugerido) throw new ErroNegocio("O encaixe da oferta mudou. Atualize a recomendação.", 409, "recompra_horario_mudou");
      if (inicio < Date.now()) throw new ErroNegocio("Esse encaixe já passou. Escolha outro horário.");
      const jaMarcado = await tx.agendamento.count({ where: { clienteId: atual.clienteId, servicoId: servico.id, status: { in: [...STATUS_ATIVOS] }, fim: { gt: new Date() } } });
      if (jaMarcado) throw new ErroNegocio("O cliente já tem esse serviço agendado.", 409);
      const clienteOcupado = await tx.agendamento.count({ where: { clienteId: atual.clienteId, adicionalDeId: null, status: { in: [...STATUS_ATIVOS] }, inicio: { lt: new Date(int.fim) }, fim: { gt: new Date(int.inicio) } } });
      if (clienteOcupado) throw new ErroNegocio("O cliente já tem outro atendimento nesse intervalo.", 409);
      await validarEncaixe(tx, atual.barbeiroId, int, { fuso: cfg.fuso, intervaloEntreClientes: cfg.intervaloEntreClientes });
      await validarCadeira(tx, atual.cadeiraId, int, undefined, cfg.intervaloEntreClientes);
      const preco = await precificar({ clienteId: atual.clienteId, servicoId: servico.id, barbeiroId: atual.barbeiroId, inicio, precoBase: sb.precoCentavos ?? servico.precoCentavos, fuso: cfg.fuso, forcarAvulso: true, c: tx });
      // Qualquer mudança de preço exige nova prévia; desconto vale somente neste serviço.
      if (preco.precoCentavos !== oportunidade.precoCentavos) throw new ErroNegocio("O preço mudou. Atualize a recomendação.", 409);
      const diaEncaixe = dataLocal(inicio, cfg.fuso), competencia = diaEncaixe.slice(0, 7);
      const [regras, extras, adicionaisBrutos] = await Promise.all([
        regrasServicosNaCompetencia(competencia, tx), extrasNaCompetencia(competencia, tx),
        tx.adicionalComissao.findMany({ where: { barbeiroId: atual.barbeiroId } }),
      ]);
      const adicionais = adicionaisBrutos.map(a => ({ ...a, inicio: a.inicio.toISOString().slice(0, 10), fim: a.fim?.toISOString().slice(0, 10) ?? null }));
      const regra = escolherRegra(regras, servico.id, atual.barbeiroId);
      const adicionalBps = adicionalNoDia(adicionais, atual.barbeiroId, preco.assinaturaId ? "ASSINATURA" : "AVULSO", diaEncaixe);
      const comissao = !regra || (preco.assinaturaId && extras.assinaturas.ativo) ? null
        : calcularComissao(regra, { modalidade: preco.assinaturaId ? "PLANO" : "AVULSO", preco: preco.precoCentavos, precoTabela: sb.precoCentavos ?? servico.precoCentavos }, adicionalBps).comissao;
      if (comissao !== oportunidade.comissaoCentavos) throw new ErroNegocio("As regras de remuneração da oferta mudaram. Atualize a recomendação.", 409, "recompra_remuneracao_mudou");
      let desconto = 0;
      if (input.aplicarDesconto) {
        const politica = await tx.recompraConfig.findUniqueOrThrow({ where: { id: 1 } });
        desconto = descontoReativacao({ politica, preco: preco.precoCentavos, custo: servico.custoCentavos,
          regra, adicionalBps,
          diasSemVisita: diasDecorridos(historico.visitas.get(atual.clienteId)!, diaEncaixe, cfg.fuso), cobertoPlano: !!preco.assinaturaId,
          expirou: !!registrada && +registrada.criadoEm + politica.descontoValidadeDias * DIA < Date.now(),
        });
        if (desconto !== oportunidade.descontoCentavos) throw new ErroNegocio("As condições da oferta mudaram. Atualize a recomendação.", 409);
      }
      const novo = await tx.agendamento.create({ data: {
        barbeiroId: atual.barbeiroId, cadeiraId: atual.cadeiraId, clienteId: atual.clienteId, servicoId: servico.id,
        inicio: new Date(inicio), fim: new Date(int.fim), origem: "PAINEL", precoCentavos: preco.precoCentavos - desconto,
        assinaturaId: preco.assinaturaId, observacao: desconto ? `Recompra: desconto autorizado de ${desconto} centavos` : "Recompra sugerida", criadoPorId: s.usuarioId,
      } });
      novoAgendamentoId = novo.id;
      let comanda = atual.itemComanda ? await tx.comanda.findUnique({ where: { id: atual.itemComanda.comandaId } }) : null;
      if (comanda) {
        await tx.$queryRaw`SELECT 1 FROM comandas WHERE id = ${comanda.id} FOR UPDATE`;
        comanda = await tx.comanda.findUnique({ where: { id: comanda.id } });
      }
      if (!comanda || comanda.status !== "ABERTA") comanda = await tx.comanda.create({ data: { clienteId: atual.clienteId, abertaPorId: s.usuarioId } });
      await tx.itemComanda.create({ data: { comandaId: comanda.id, agendamentoId: novo.id, descricao: descricaoServico(servico.nome, atual.barbeiro.nome, !!preco.assinaturaId), quantidade: 1, precoUnitCentavos: novo.precoCentavos, barbeiroId: atual.barbeiroId } });
      await auditar(tx, s.usuarioId, "recompra_agendar", "agendamento", novo.id, { principalId: atual.id, comandaId: comanda.id, descontoCentavos: desconto, precoCentavos: novo.precoCentavos });
    }
    const dados = { clienteId: atual.clienteId, ultimaEm: new Date(oportunidade.ultimaEm), estado: input.estado, lembrarEm: input.estado === "LEMBRAR" ? input.lembrarEm : null, criadoPorId: s.usuarioId, ...(novoAgendamentoId ? { novoAgendamentoId } : {}) };
    const oferta = await tx.ofertaRecompra.upsert({ where: { agendamentoId_servicoId: chave }, create: { ...chave, ...dados }, update: dados });
    await auditar(tx, s.usuarioId, "recompra_oferta", "oferta_recompra", oferta.id, { antes: registrada?.estado ?? null, depois: input.estado });
    return oferta;
  });
  publicar({ tipo: "agenda", barbeiroIds: [principal.barbeiroId], datas: [dia] });
  return resultado;
}
