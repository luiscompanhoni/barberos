import { beforeEach, describe, expect, it, vi } from "vitest";
import { enviarAutomacao } from "@/lib/automacoes/enviar";
import { Prisma } from "@prisma/client";

const m = vi.hoisted(() => ({ criar: vi.fn(), atualizar: vi.fn(), enviar: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { automacaoEnviada: { create: m.criar, update: m.atualizar } } }));
vi.mock("@/lib/whatsapp/conversas", () => ({ notificarCliente: m.enviar }));
const entrada = { tipo: "ESPERA_HORARIO" as const, chave: "espera", clienteId: "cliente", telefone: "5500000000000", texto: "Teste fictício" };

describe("resultado do envio automático", () => {
  beforeEach(() => { vi.clearAllMocks(); m.criar.mockResolvedValue({ id: "envio" }); m.enviar.mockResolvedValue({ ok: true, erro: null }); });
  it("devolve sucesso somente quando o canal confirma", async () => {
    expect(await enviarAutomacao(entrada)).toBe(true);
    expect(m.atualizar).not.toHaveBeenCalled();
  });
  it("falha do canal ou exceção não é apresentada como aviso entregue", async () => {
    m.enviar.mockResolvedValueOnce({ ok: false, erro: "Envios bloqueados" });
    expect(await enviarAutomacao(entrada)).toBe(false);
    expect(m.atualizar).toHaveBeenCalledWith({ where: { id: "envio" }, data: { ok: false, erro: "Envios bloqueados" } });
    m.enviar.mockRejectedValueOnce(new Error("Resultado desconhecido"));
    expect(await enviarAutomacao(entrada)).toBe(false);
  });
  it("repetição não envia de novo nem apaga o registro de resultado ambíguo", async () => {
    m.criar.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("duplicado", { code: "P2002", clientVersion: "6" }));
    expect(await enviarAutomacao(entrada)).toBe(false);
    expect(m.enviar).not.toHaveBeenCalled(); expect(m.atualizar).not.toHaveBeenCalled();
  });
});
