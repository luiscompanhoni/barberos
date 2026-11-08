import { z } from "zod";

const zFaixas = z.record(z.string(), z.tuple([z.string().regex(/^\d{2}:\d{2}$/), z.string().regex(/^\d{2}:\d{2}$/)]));
const schema = z.object({
  tipoDados: z.enum(["SINTETICOS", "EXPORTACAO_REAL"]),
  fonte: z.string().min(1),
  servicos: z.array(z.tuple([z.string().min(1), z.number().int().positive(), z.number().nonnegative()])).min(1),
  barbeiros: z.array(z.object({
    nome: z.string().min(1), nomeCompleto: z.string().min(1), telefone: z.string().min(1),
    dono: z.boolean().optional(), cor: z.string().regex(/^#[a-fA-F0-9]{6}$/),
    servicos: z.record(z.string(), z.number().int().positive()), horarios: zFaixas, intervalos: zFaixas,
  })),
  planos: z.array(z.object({ nome: z.string().min(1), preco: z.number().nonnegative(), vagas: z.number().int().nonnegative(), servicos: z.array(z.string()), descricao: z.string() })),
  produtos: z.array(z.tuple([z.string().min(1), z.number().nonnegative(), z.enum(["B", "L"])])),
});

/** A fixture versionada não é um backup ou fonte para cadastrar pessoas reais. */
export function validarImportacaoCashbarber(entrada: unknown, opcoes: { exemplo: boolean; arquivoExplicito: boolean; databaseUrl: string | undefined }) {
  const dados = schema.parse(entrada);
  if (opcoes.exemplo) {
    if (dados.tipoDados !== "SINTETICOS") throw new Error("O modo exemplo aceita somente dados sintéticos.");
    let url: URL;
    try { url = new URL(opcoes.databaseUrl ?? ""); } catch { throw new Error("Informe um banco local descartável para o exemplo."); }
    const banco = decodeURIComponent(url.pathname.slice(1));
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      || !/^barberos_(?:test|teste|demo)(?:_|$)/.test(banco)) throw new Error("Exemplo restrito a banco local barberos_test*, barberos_teste* ou barberos_demo*.");
    if (dados.barbeiros.some(b => !/^sintetico-\d{3}$/.test(b.telefone) || b.dono)) {
      throw new Error("O exemplo exige identificadores sintéticos não discáveis e não pode criar donos.");
    }
  } else if (!opcoes.arquivoExplicito || dados.tipoDados !== "EXPORTACAO_REAL") {
    throw new Error("A fixture não pode ser importada como cadastro real. Informe --arquivo com exportação privada marcada EXPORTACAO_REAL; use --exemplo apenas em banco descartável.");
  }
  return dados;
}
