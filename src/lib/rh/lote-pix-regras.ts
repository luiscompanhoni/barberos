import { createHash } from "node:crypto";
import { z } from "zod";
import { ErroNegocio } from "@/lib/erros";
import { conferirPixProtegido, type CadastroPixProtegido } from "./pix-protegido";
export { analisarChavePix } from "./pix-regras";

export const zCompetenciaPix = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Competência no formato AAAA-MM");
export const zRevisaoPix = z.string().regex(/^[a-f0-9]{64}$/);
const hash = (s: string) => createHash("sha256").update(s).digest("hex");

export type FolhaParaPix = {
  ativa?: boolean; versao?: number;
  id: string; pessoaId: string; status: string; criadoEm: Date;
  salarioCentavos: number; comissaoCentavos: number; adicionaisCentavos: number; descontosCentavos: number; liquidoCentavos: number;
  pessoa: { nome: string; ativo: boolean; revisaoPix: number } & CadastroPixProtegido;
};

export function planejarLotePix(competencia: string, folhas: FolhaParaPix[]) {
  zCompetenciaPix.parse(competencia);
  const ordenadas = folhas.filter(f => f.ativa !== false).sort((a, b) => a.id.localeCompare(b.id));
  const estado = ordenadas.map(f => ({
    id: f.id, pessoaId: f.pessoaId, versao: f.versao ?? 1, status: f.status, criadoEm: f.criadoEm.toISOString(),
    salario: f.salarioCentavos, comissao: f.comissaoCentavos, adicionais: f.adicionaisCentavos,
    descontos: f.descontosCentavos, liquido: f.liquidoCentavos,
    nome: f.pessoa.nome, ativo: f.pessoa.ativo, revisaoPix: f.pessoa.revisaoPix,
    chaveHash: conferirPixProtegido(f.pessoaId, f.pessoa).hash,
    protecao: conferirPixProtegido(f.pessoaId, f.pessoa).estado,
  }));
  const itens = ordenadas.filter(f => f.status === "FECHADA" && f.liquidoCentavos > 0).map(f => {
    const chave = conferirPixProtegido(f.pessoaId, f.pessoa);
    return {
      folhaId: f.id, pessoaId: f.pessoaId, nome: f.pessoa.nome, valorCentavos: f.liquidoCentavos,
      tipoChave: chave.tipo, chaveMascarada: chave.mascara, chaveHash: chave.hash,
      problemas: chave.problema ? [chave.problema] : [],
      destinatario: "NAO_VERIFICADO" as const,
    };
  });
  const contagens = new Map<string, number>();
  for (const item of itens) if (item.tipoChave) contagens.set(item.chaveHash, (contagens.get(item.chaveHash) ?? 0) + 1);
  for (const item of itens) if ((contagens.get(item.chaveHash) ?? 0) > 1) item.problemas.push("Chave compartilhada por mais de um profissional neste lote. Confira os cadastros.");
  const totalCentavos = itens.reduce((n, item) => n + item.valorCentavos, 0);
  if (!Number.isSafeInteger(totalCentavos) || totalCentavos > 2_147_483_647 || itens.some(i => !Number.isSafeInteger(i.valorCentavos))) throw new ErroNegocio("Valores inválidos na folha.", 409, "folha_invalida");
  return {
    competencia, revisao: hash(JSON.stringify({ versao: 1, competencia, estado })), itens, totalCentavos,
    podeConferir: itens.length > 0 && itens.every(i => !i.problemas.length),
    excluidas: folhas.length - itens.length,
    envioHabilitado: false as const,
    bloqueioEnvio: "Envio bloqueado: API Pix de saída da Stone ainda não homologada. Destinatários não verificados pelo banco.",
  };
}
