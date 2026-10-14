/**
 * Consulta da auditoria para a tela do dono: filtros por periodo, pessoa e tipo, mais novos primeiro, em paginas.
 */
import type { Prisma } from "@prisma/client";
import { configuracao } from "@/lib/agenda/carregar";
import { instanteLocal, somarDias } from "@/lib/agenda/tempo";
import { descreverAcao, ENTIDADES, linhasDeMudanca, resumoAparelho } from "@/lib/auditoria-regras";
import { db } from "@/lib/db";
import { ErroNegocio } from "@/lib/erros";

const PAGINA = 50;
const PAPEL: Record<string, string> = { DONO: "dono", RECEPCAO: "recepção", BARBEIRO: "barbeiro", CLIENTE: "cliente" };

/** `depois`: cursor "instante|id" da ultima linha da pagina anterior (linhas no mesmo milissegundo nao se perdem). */
export async function consultarAuditoria(f: { de: string; ate: string; usuarioId?: string | null; entidade?: string | null; depois?: string | null }) {
  if (f.ate < f.de) throw new ErroNegocio("A data final é antes da inicial.");
  const fuso = (await configuracao()).fuso;
  const [cursorEm, cursorId] = f.depois ? f.depois.split("|") : [null, null];
  const where: Prisma.AuditoriaWhereInput = {
    criadoEm: { gte: new Date(instanteLocal(f.de, 0, fuso)), lt: new Date(instanteLocal(somarDias(f.ate, 1), 0, fuso)) },
    ...(f.usuarioId === "sistema" ? { usuarioId: null } : f.usuarioId ? { usuarioId: f.usuarioId } : {}),
    ...(f.entidade ? { entidade: f.entidade } : {}),
    ...(cursorEm && cursorId ? { OR: [{ criadoEm: { lt: new Date(cursorEm) } }, { criadoEm: new Date(cursorEm), id: { lt: cursorId } }] } : {}),
  };
  const linhas = await db.auditoria.findMany({ where, orderBy: [{ criadoEm: "desc" }, { id: "desc" }], take: PAGINA + 1 });
  const pagina = linhas.slice(0, PAGINA);
  const ids = [...new Set(pagina.map((l) => l.usuarioId).filter(Boolean))] as string[];
  const [usuarios, equipe] = await Promise.all([
    db.usuario.findMany({ where: { id: { in: ids } }, select: { id: true, nome: true, papel: true } }),
    db.usuario.findMany({ where: { papel: { not: "CLIENTE" } }, orderBy: { nome: "asc" }, select: { id: true, nome: true, papel: true } }),
  ]);
  const quem = new Map(usuarios.map((u) => [u.id, u]));
  return {
    itens: pagina.map((l) => {
      const u = l.usuarioId ? quem.get(l.usuarioId) : null;
      return {
        id: l.id, criadoEm: l.criadoEm, acao: l.acao, entidade: l.entidade, entidadeId: l.entidadeId,
        quem: u ? u.nome : l.usuarioId ? "(acesso removido)" : "Sistema", papel: u ? PAPEL[u.papel] : null,
        descricao: descreverAcao(l.acao, l.entidade), mudancas: linhasDeMudanca(l.dados), dados: l.dados,
        ip: l.ip, aparelho: resumoAparelho(l.dispositivo),
      };
    }),
    // Proxima pagina: tudo depois (mais antigo que) o ultimo desta.
    proximo: linhas.length > PAGINA ? `${pagina[pagina.length - 1].criadoEm.toISOString()}|${pagina[pagina.length - 1].id}` : null,
    filtros: {
      pessoas: [...equipe.map((u) => ({ id: u.id, nome: `${u.nome} (${PAPEL[u.papel]})` })), { id: "sistema", nome: "Sistema (automático)" }],
      entidades: Object.entries(ENTIDADES).map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome)),
    },
  };
}
