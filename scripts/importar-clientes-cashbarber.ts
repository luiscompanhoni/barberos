/**
 * Importa os clientes exportados do CashBarber (Cadastros > Lista de clientes > exportar CSV).
 * - Telefone vira o formato do sistema (55 + DDD + 9 digitos); sem telefone valido, fica de fora.
 * - Telefone repetido vira um cadastro so (o da visita mais recente; os outros nomes vao na observacao).
 * - Cliente que ja existe no BarberOS nao e sobrescrito: so completa CPF, e-mail e nascimento vazios.
 * O CSV tem dados pessoais: nao copiar para dentro do projeto.
 * Rodar: DATABASE_URL=... npx tsx scripts/importar-clientes-cashbarber.ts "C:/Users/.../Clientes.csv"
 */
import { readFileSync } from "node:fs";
import { Prisma, PrismaClient } from "@prisma/client";

const db = new PrismaClient();

/** CSV com aspas (formato do CashBarber). */
function lerCsv(texto: string): string[][] {
  const t = texto.replace(/^\uFEFF/, "");
  const linhas: string[][] = [];
  let campo = "", linha: string[] = [], aspas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (aspas) {
      if (c === '"') { if (t[i + 1] === '"') { campo += '"'; i++; } else aspas = false; } else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ",") { linha.push(campo); campo = ""; }
    else if (c === "\n") { linha.push(campo.replace(/\r$/, "")); linhas.push(linha); linha = []; campo = ""; }
    else campo += c;
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}

export function telefoneBr(s: string): string | null {
  let d = (s || "").replace(/\D/g, "");
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  if (d.length === 10 && /[6-9]/.test(d[2])) d = `${d.slice(0, 2)}9${d.slice(2)}`; // celular antigo sem o 9
  return d.length === 11 && d[2] === "9" && !/^0/.test(d) ? `55${d}` : null;
}

const vazio = (s: string | undefined) => !s || s === "N/A" ? null : s.trim();
function data(s: string | undefined): Date | null {
  const m = vazio(s)?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  return isNaN(d.getTime()) ? null : d;
}
const nascimento = (s: string | undefined) => {
  const d = data(s);
  return d && d.getUTCFullYear() >= 1920 && d.getUTCFullYear() <= new Date().getUTCFullYear() - 3 ? d : null;
};
const br = (d: Date) => d.toISOString().slice(0, 10).split("-").reverse().join("/");

type Linha = { nome: string; cpf: string | null; email: string | null; nasc: Date | null; cadastro: Date | null; visita: Date | null };

async function main() {
  const arquivo = process.argv[2];
  if (!arquivo) throw new Error("Informe o caminho do CSV.");
  const [cab, ...linhas] = lerCsv(readFileSync(arquivo, "utf8"));
  const col = (n: string) => { const i = cab.indexOf(n); if (i < 0) throw new Error(`Coluna "${n}" não encontrada.`); return i; };
  const C = { nome: col("Nome"), cpf: col("CPF"), email: col("Email"), tel: col("Telefone"), nasc: col("Data de nascimento"), cad: col("Data de cadastro"), visita: cab.findIndex((c) => c.toLowerCase().includes("ltima visita")) };

  const porTelefone = new Map<string, Linha[]>();
  let semTelefone = 0;
  for (const l of linhas) {
    if (l.length < cab.length - 1) continue;
    const tel = telefoneBr(l[C.tel]);
    if (!tel) { semTelefone++; continue; }
    const item: Linha = {
      nome: l[C.nome].replace(/\s+/g, " ").trim() || "Cliente", cpf: vazio(l[C.cpf]), email: vazio(l[C.email])?.toLowerCase() ?? null,
      nasc: nascimento(l[C.nasc]), cadastro: data(l[C.cad]), visita: C.visita >= 0 ? data(l[C.visita]) : null,
    };
    porTelefone.set(tel, [...(porTelefone.get(tel) ?? []), item]);
  }

  const existentes = new Map((await db.cliente.findMany({ select: { id: true, telefone: true, cpf: true, email: true, dataNascimento: true } })).map((c) => [c.telefone, c]));
  const novos: Prisma.ClienteCreateManyInput[] = [];
  let completados = 0, juntados = 0;
  for (const [telefone, grupo] of porTelefone) {
    grupo.sort((a, b) => (b.visita?.getTime() ?? 0) - (a.visita?.getTime() ?? 0));
    const p = grupo[0];
    const cpf = grupo.find((g) => g.cpf)?.cpf ?? null;
    const email = grupo.find((g) => g.email)?.email ?? null;
    const nasc = p.nasc ?? grupo.find((g) => g.nasc)?.nasc ?? null;
    const outros = [...new Set(grupo.slice(1).map((g) => g.nome).filter((n) => n.toLowerCase() !== p.nome.toLowerCase()))];
    if (grupo.length > 1) juntados += grupo.length - 1;

    const ex = existentes.get(telefone);
    if (ex) {
      const data = { ...(!ex.cpf && cpf ? { cpf } : {}), ...(!ex.email && email ? { email } : {}), ...(!ex.dataNascimento && nasc ? { dataNascimento: nasc } : {}) };
      if (Object.keys(data).length) { await db.cliente.update({ where: { id: ex.id }, data }); completados++; }
      continue;
    }
    const obs = [
      p.visita ? `Última visita no CashBarber: ${br(p.visita)}.` : null,
      outros.length ? `Outros nomes com este telefone: ${outros.join(", ")}.` : null,
    ].filter(Boolean).join(" ");
    novos.push({ telefone, nome: p.nome, cpf, email, dataNascimento: nasc, observacoes: obs || null, origemDetalhe: "Importado do CashBarber", ...(p.cadastro ? { criadoEm: p.cadastro } : {}) });
  }

  for (let i = 0; i < novos.length; i += 500) await db.cliente.createMany({ data: novos.slice(i, i + 500), skipDuplicates: true });
  console.log(`linhas no CSV: ${linhas.filter((l) => l.length >= cab.length - 1).length}`);
  console.log(`sem telefone válido (ficaram de fora): ${semTelefone}`);
  console.log(`telefones repetidos juntados: ${juntados}`);
  console.log(`clientes novos: ${novos.length} | já existiam e foram completados: ${completados}`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => db.$disconnect());
