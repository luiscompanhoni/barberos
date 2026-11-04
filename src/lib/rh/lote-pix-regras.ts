import { createHash } from "node:crypto";
import { z } from "zod";
import { cpfValido } from "@/lib/assinaturas/regras";
import { ErroNegocio } from "@/lib/erros";

export const zCompetenciaPix = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Competência no formato AAAA-MM");
export const zRevisaoPix = z.string().regex(/^[a-f0-9]{64}$/);
const hash = (s: string) => createHash("sha256").update(s).digest("hex");

function cnpjValido(d: string) {
  if (!/^\d{14}$/.test(d) || /^(\d)\1+$/.test(d)) return false;
  const digito = (base: string) => {
    let peso = 2;
    const soma = [...base].reverse().reduce((t, n) => { const v = Number(n) * peso; peso = peso === 9 ? 2 : peso + 1; return t + v; }, 0);
    return soma % 11 < 2 ? 0 : 11 - soma % 11;
  };
  return digito(d.slice(0, 12)) === Number(d[12]) && digito(d.slice(0, 13)) === Number(d[13]);
}

/** Valida apenas o formato local. Nunca comprova existência ou titularidade bancária. */
export function analisarChavePix(entrada: string | null) {
  const original = (entrada ?? "").trim();
  const digitos = original.replace(/[.\-/]/g, "");
  let tipo: "CPF" | "CNPJ" | "EMAIL" | "TELEFONE" | "ALEATORIA" | null = null;
  let normalizada = original;
  if (/^[\d.\-/]+$/.test(original) && cpfValido(digitos)) { tipo = "CPF"; normalizada = digitos; }
  else if (/^[\d.\-/]+$/.test(original) && cnpjValido(digitos)) { tipo = "CNPJ"; normalizada = digitos; }
  else if (z.email().safeParse(original).success && original.length <= 77) { tipo = "EMAIL"; normalizada = original.toLowerCase(); }
  else if (/^\+[1-9]\d{9,14}$/.test(original)) tipo = "TELEFONE";
  else if (/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(original)) { tipo = "ALEATORIA"; normalizada = original.toLowerCase(); }
  return {
    tipo, hash: hash(normalizada), mascarada: original ? `••••${normalizada.slice(-4)}` : "Não cadastrada",
    problema: !original ? "Chave Pix ausente." : !tipo ? "Formato da chave inválido. Para telefone, use + e código do país." : null,
  };
}

export type FolhaParaPix = {
  id: string; pessoaId: string; status: string; criadoEm: Date;
  salarioCentavos: number; comissaoCentavos: number; adicionaisCentavos: number; descontosCentavos: number; liquidoCentavos: number;
  pessoa: { nome: string; chavePix: string | null; ativo: boolean; revisaoPix: number };
};

export function planejarLotePix(competencia: string, folhas: FolhaParaPix[]) {
  zCompetenciaPix.parse(competencia);
  const ordenadas = [...folhas].sort((a, b) => a.id.localeCompare(b.id));
  const estado = ordenadas.map(f => ({
    id: f.id, pessoaId: f.pessoaId, status: f.status, criadoEm: f.criadoEm.toISOString(),
    salario: f.salarioCentavos, comissao: f.comissaoCentavos, adicionais: f.adicionaisCentavos,
    descontos: f.descontosCentavos, liquido: f.liquidoCentavos,
    nome: f.pessoa.nome, ativo: f.pessoa.ativo, revisaoPix: f.pessoa.revisaoPix,
    chaveHash: analisarChavePix(f.pessoa.chavePix).hash,
  }));
  const itens = ordenadas.filter(f => f.status === "FECHADA" && f.liquidoCentavos > 0).map(f => {
    const chave = analisarChavePix(f.pessoa.chavePix);
    return {
      folhaId: f.id, pessoaId: f.pessoaId, nome: f.pessoa.nome, valorCentavos: f.liquidoCentavos,
      tipoChave: chave.tipo, chaveMascarada: chave.mascarada, chaveHash: chave.hash,
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
