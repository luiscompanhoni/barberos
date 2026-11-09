import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ usuario: vi.fn(), enviar: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { usuario: { findFirst: m.usuario } } }));
vi.mock("@/lib/whatsapp/evolution", () => ({ enviarTextoEvolution: m.enviar }));
vi.mock("@/lib/auditoria", () => ({ auditar: vi.fn() }));
import { destinatarioTesteEquipe, envioTesteEquipe } from "@/lib/whatsapp/teste-equipe";
import { enviarTexto, enviarTemplate } from "@/lib/whatsapp/canal";
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("WHATSAPP_ATENDIMENTO_TESTE_EQUIPE", "true"); });
afterEach(() => vi.unstubAllEnvs());
it("consulta apenas dono/gerente ativo pelo telefone canônico", async () => {
  m.usuario.mockResolvedValue({ id: "dono" });
  expect(await destinatarioTesteEquipe("5547999990000@s.whatsapp.net")).toBe(true);
  expect(m.usuario).toHaveBeenCalledWith({ where: { telefone: "5547999990000", ativo: true, papel: { in: ["DONO", "GERENTE"] } }, select: { id: true } });
});
it("não autoriza cliente, telefone inválido nem modo desligado", async () => {
  m.usuario.mockResolvedValue(null);
  expect(await destinatarioTesteEquipe("5547999990000")).toBe(false);
  for (const numero of ["invalido", "5547999990000@g.us", "5547999990000@lid", "abc5547999990000"]) expect(await destinatarioTesteEquipe(numero)).toBe(false);
  vi.stubEnv("WHATSAPP_ATENDIMENTO_TESTE_EQUIPE", "false");
  expect(await destinatarioTesteEquipe("5547999990000")).toBe(false);
  expect(m.usuario).toHaveBeenCalledTimes(1);
});
it("quarentena não libera exceção de IA nem envio", async () => {
  vi.stubEnv("BARBEROS_QUARENTENA_RESTAURACAO", "true");
  m.usuario.mockResolvedValue({ id: "dono" });
  expect(await destinatarioTesteEquipe("5547999990000")).toBe(false);
  expect(m.usuario).not.toHaveBeenCalled();
});
it("campanha, template e piloto de entrevista não ganham exceção de envio", async () => {
  m.usuario.mockResolvedValue({ id: "dono" });
  for (const origem of ["PADRAO", "TEMPLATE", "ENTREVISTA_PILOTO", "CAMPANHA"]) expect(await envioTesteEquipe("5547999990000", origem)).toBe(false);
  expect(m.usuario).not.toHaveBeenCalled();
  expect(await envioTesteEquipe("5547999990000", "ATENDIMENTO")).toBe(true);
});
it("bloqueio geral deixa passar somente resposta de atendimento a membro ativo", async () => {
  vi.stubEnv("WHATSAPP_ENVIOS_BLOQUEADOS", "true");
  vi.stubEnv("WHATSAPP_PROVIDER", "evolution");
  vi.stubEnv("AMBIENTE", "producao");
  vi.stubEnv("WHATSAPP_PILOTO_ENTREVISTAS_HABILITADO", "true");
  m.usuario.mockResolvedValue({ id: "dono" }); m.enviar.mockResolvedValue({ wamid: "fixture" });
  await enviarTexto("5547999990000", "Resposta solicitada", 0, "ATENDIMENTO");
  expect(m.enviar).toHaveBeenCalledTimes(1);
  await expect(enviarTexto("5547999990000", "Campanha")).rejects.toThrow("bloqueados");
  await expect(enviarTemplate("5547999990000", { nome: "campanha", parametros: [] })).rejects.toThrow("Templates bloqueados");
  m.usuario.mockResolvedValue(null);
  await expect(enviarTexto("5547999990001", "Cliente externo", 0, "ATENDIMENTO")).rejects.toThrow("bloqueados");
  expect(m.enviar).toHaveBeenCalledTimes(1);
});
