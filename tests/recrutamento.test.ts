import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => {
  const tx = { vagaRecrutamento: { findFirst: vi.fn() }, candidatoRecrutamento: { create: vi.fn() }, candidaturaRecrutamento: { create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() }, historicoRecrutamento: { create: vi.fn() } };
  return { tx, db: { candidaturaRecrutamento: { findUnique: vi.fn() }, $transaction: vi.fn() }, auditar: vi.fn() };
});
vi.mock("@/lib/db", () => ({ db: m.db }));
vi.mock("@/lib/auditoria", () => ({ auditar: m.auditar }));
import { receberCandidatura, mudarEtapa } from "@/lib/recrutamento/servico";
import { zCandidatura, zVaga, podeRecrutar } from "@/lib/recrutamento/regras";
const formulario = { envioId: "37f1774b-6347-481c-b685-b0b0cf4f61ab", nome: "Teste profissional", telefone: "11999998888", cidade: "São Paulo", experienciaMeses: 0, servicos: ["Barba"], disponibilidade: "Segunda a sexta", cienciaPrivacidade: true };
const entrada = () => zCandidatura.parse(formulario);
beforeEach(() => {
  vi.resetAllMocks(); m.db.$transaction.mockImplementation((fn) => fn(m.tx));
  m.db.candidaturaRecrutamento.findUnique.mockResolvedValue(null);
  m.tx.vagaRecrutamento.findFirst.mockResolvedValue({ id: "vaga", privacidade: "Aviso versão desta vaga" });
  m.tx.candidatoRecrutamento.create.mockResolvedValue({ id: "candidato" });
  m.tx.candidaturaRecrutamento.create.mockResolvedValue({ id: "candidatura" });
});
describe("regras de recrutamento", () => {
  it("aceita iniciante sem redes sociais e autorização futura", () => {
    const b = entrada(); expect(b.telefone).toBe("5511999998888"); expect(b.instagram).toBe(""); expect(b.futurasOportunidades).toBe(false); expect(b.experienciaMeses).toBe(0);
  });
  it.each(["javascript:alert(1)", "http://site.com", "https://usuario:senha@site.com"])("recusa link inseguro %s", (portfolio) => expect(zCandidatura.safeParse({ ...formulario, portfolio }).success).toBe(false));
  it("exige ciência da finalidade", () => expect(zCandidatura.safeParse({ ...formulario, cienciaPrivacidade: false }).success).toBe(false));
  it("não permite etapa vinda de formulário público", () => expect(zCandidatura.safeParse({ ...formulario, etapa: "CONTRATADO" }).success).toBe(false));
  it("exige serviço e experiência não negativa", () => { expect(zCandidatura.safeParse({ ...formulario, servicos: [] }).success).toBe(false); expect(zCandidatura.safeParse({ ...formulario, experienciaMeses: -1 }).success).toBe(false); });
  it("aceita UTMs e rejeita dados arbitrários de atribuição", () => {
    expect(zCandidatura.parse({ ...formulario, origem: { utm_campaign: "barbeiros" } }).origem.utm_campaign).toBe("barbeiros");
    expect(zCandidatura.safeParse({ ...formulario, origem: { cpf: "123" } }).success).toBe(false);
  });
  it("vaga nasce fechada e exige aviso", () => {
    expect(zVaga.parse({ titulo: "Barbeiro", cidade: "Rio do Sul", descricao: "Condições da vaga", privacidade: "Finalidade e contato" }).ativa).toBe(false);
    expect(zVaga.safeParse({ titulo: "Barbeiro", cidade: "SC", descricao: "Descrição" }).success).toBe(false);
  });
  it.each(["BARBEIRO", "RECEPCAO", "CLIENTE", ""])("não expõe candidatos para %s", (p) => expect(podeRecrutar(p)).toBe(false));
  it("permite gestão", () => { expect(podeRecrutar("DONO")).toBe(true); expect(podeRecrutar("GERENTE")).toBe(true); });
});
describe("gravação de recrutamento", () => {
  it("preserva UTMs e versão do aviso sem dados pessoais no log genérico", async () => {
    await receberCandidatura("vaga", { ...entrada(), origem: { utm_source: "instagram" } });
    const d = m.tx.candidaturaRecrutamento.create.mock.calls[0][0].data;
    expect(d.origem).toEqual({ utm_source: "instagram" }); expect(d.avisoPrivacidade).toBe("Aviso versão desta vaga"); expect(d.formularioVersao).toBeTruthy();
    expect(JSON.stringify(m.auditar.mock.calls)).not.toContain("11999998888");
    expect(m.db.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: "Serializable" }));
  });
  it("reenvio idêntico não duplica cadastro", async () => {
    await receberCandidatura("vaga", entrada()); const hash = m.tx.candidaturaRecrutamento.create.mock.calls[0][0].data.conteudoHash;
    m.db.candidaturaRecrutamento.findUnique.mockResolvedValue({ conteudoHash: hash });
    await receberCandidatura("vaga", entrada()); expect(m.tx.candidatoRecrutamento.create).toHaveBeenCalledTimes(1);
  });
  it("não reutiliza chave com conteúdo diferente", async () => {
    m.db.candidaturaRecrutamento.findUnique.mockResolvedValue({ conteudoHash: "outro" });
    await expect(receberCandidatura("vaga", entrada())).rejects.toMatchObject({ status: 409 }); expect(m.tx.candidatoRecrutamento.create).not.toHaveBeenCalled();
  });
  it("não recebe vaga fechada", async () => {
    m.tx.vagaRecrutamento.findFirst.mockResolvedValue(null);
    await expect(receberCandidatura("vaga", entrada())).rejects.toMatchObject({ status: 404 }); expect(m.tx.candidatoRecrutamento.create).not.toHaveBeenCalled();
  });
  it("não combina identidades por telefone não verificado", async () => {
    await receberCandidatura("vaga", entrada()); await receberCandidatura("vaga", { ...entrada(), envioId: "6488a4e4-8399-4315-b4ce-ab475b94d4d8" });
    expect(m.tx.candidatoRecrutamento.create).toHaveBeenCalledTimes(2);
  });
  it("não inclui no banco futuro sem consentimento", async () => {
    m.tx.candidaturaRecrutamento.findUnique.mockResolvedValue({ futurasOportunidades: false });
    await expect(mudarEtapa("c", "gestor", { etapa: "BANCO", versao: 0, motivo: "Próxima vaga" })).rejects.toMatchObject({ status: 422 });
    expect(m.tx.candidaturaRecrutamento.updateMany).not.toHaveBeenCalled();
  });
  it("recusa alteração concorrente sem perder análise anterior", async () => {
    m.tx.candidaturaRecrutamento.findUnique.mockResolvedValue({ etapa: "NOVO" }); m.tx.candidaturaRecrutamento.updateMany.mockResolvedValue({ count: 0 });
    await expect(mudarEtapa("c", "gestor", { etapa: "TRIAGEM", versao: 0, motivo: "Análise técnica" })).rejects.toMatchObject({ status: 409 });
    expect(m.tx.historicoRecrutamento.create).not.toHaveBeenCalled();
  });
  it("registra autor e análise na transação", async () => {
    m.tx.candidaturaRecrutamento.findUnique.mockResolvedValue({ etapa: "NOVO" }); m.tx.candidaturaRecrutamento.updateMany.mockResolvedValue({ count: 1 });
    await mudarEtapa("c", "gestor", { etapa: "ENTREVISTA", versao: 0, motivo: "Revisar portfólio" });
    expect(m.tx.historicoRecrutamento.create).toHaveBeenCalledWith({ data: { candidaturaId: "c", usuarioId: "gestor", etapa: "ENTREVISTA", motivo: "Revisar portfólio" } });
  });
});
