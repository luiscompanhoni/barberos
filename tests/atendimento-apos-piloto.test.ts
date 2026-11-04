import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn(), lock: vi.fn(), evolution: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ auditar: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $transaction: (fn: (tx: unknown) => unknown) => fn({
  $executeRaw: m.lock, pilotoEntrevistaWhatsApp: { findUnique: m.find, update: m.update },
}) } }));
vi.mock("@/lib/whatsapp/evolution", () => ({ enviarTextoEvolution: m.evolution }));
import { enviarTexto, enviarTemplate } from "@/lib/whatsapp/canal";

const telefone = "5547999990000";
const piloto = { ativo: false, telefone, expiraEm: new Date(0), enviados: 2, versao: 2 };
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("WHATSAPP_PILOTO_ENTREVISTAS_HABILITADO", "true");
  vi.stubEnv("WHATSAPP_ATENDIMENTO_APOS_PILOTO", "true");
  vi.stubEnv("WHATSAPP_PROVIDER", "evolution");
  vi.stubEnv("AMBIENTE", "producao");
  m.find.mockResolvedValue(piloto); m.evolution.mockResolvedValue({ wamid: "fixture" });
});
afterEach(() => vi.unstubAllEnvs());

describe("separação do atendimento após piloto", () => {
  it("permite somente a finalidade de atendimento ao encerrar o piloto", async () => {
    await enviarTexto(telefone, "resposta", 0, "ATENDIMENTO");
    expect(m.evolution).toHaveBeenCalledTimes(1);
    await expect(enviarTexto(telefone, "automação")).rejects.toMatchObject({ status: 403 });
    await expect(enviarTemplate(telefone, { nome: "aviso", parametros: [] })).rejects.toMatchObject({ status: 403 });
    await expect(enviarTexto(telefone, "entrevista", 0, "ENTREVISTA_PILOTO")).rejects.toMatchObject({ status: 403 });
    expect(m.evolution).toHaveBeenCalledTimes(1); expect(m.update).not.toHaveBeenCalled();
  });
  it.each([null, { ...piloto, ativo: true }])("mantém atendimento bloqueado sem encerramento explícito %#", async estado => {
    m.find.mockResolvedValue(estado);
    await expect(enviarTexto(telefone, "resposta", 0, "ATENDIMENTO")).rejects.toMatchObject({ status: 403 });
    expect(m.evolution).not.toHaveBeenCalled();
  });
  it("exige chave explícita de reabertura", async () => {
    vi.stubEnv("WHATSAPP_ATENDIMENTO_APOS_PILOTO", "false");
    await expect(enviarTexto(telefone, "resposta", 0, "ATENDIMENTO")).rejects.toMatchObject({ status: 403 });
    expect(m.evolution).not.toHaveBeenCalled();
  });
});
