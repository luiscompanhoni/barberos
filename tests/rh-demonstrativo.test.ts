import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/rh/demonstrativo/route";
import { naoAutorizado } from "@/lib/erros";
import { demonstrativoDisponivel, podeVerDemonstrativo } from "@/lib/rh/demonstrativo";

const m = vi.hoisted(() => ({ sessao: vi.fn(), permissoes: vi.fn() }));
vi.mock("@/lib/auth/sessao", () => ({ GESTAO: ["DONO", "GERENTE"], exigirSessao: m.sessao }));
vi.mock("@/lib/auth/permissoes", () => ({ permissoesDoUsuario: m.permissoes }));

const tudo = { lucro: true, comissao: true, folha: true };
let pasta: string;
let arquivo: string;
beforeEach(async () => {
  vi.resetAllMocks();
  m.sessao.mockResolvedValue({ papel: "GERENTE" });
  m.permissoes.mockResolvedValue(tudo);
  pasta = await mkdtemp(join(tmpdir(), "rh-demonstrativo-"));
  arquivo = join(pasta, "demonstrativo.xlsx");
  vi.stubEnv("DEMONSTRATIVO_RH_ARQUIVO", arquivo);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(pasta, { recursive: true, force: true });
});

describe("demonstrativo gerencial", () => {
  it("entrega somente o anexo configurado, como download privado", async () => {
    const bytes = new Uint8Array([80, 75, 3, 4, 7]);
    await writeFile(arquivo, bytes);
    expect(await demonstrativoDisponivel()).toBe(true);
    const r = await GET();
    expect(m.sessao).toHaveBeenCalledWith(["DONO", "GERENTE"]);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(r.headers.get("content-disposition")).toContain("attachment;");
    expect(r.headers.get("content-type")).toContain("spreadsheetml.sheet");
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(bytes);
  });
  it("exige sessão e permissões dos dois relatórios antes de ler o arquivo", async () => {
    m.sessao.mockRejectedValueOnce(naoAutorizado());
    expect((await GET()).status).toBe(401);
    expect(m.permissoes).not.toHaveBeenCalled();
    m.permissoes.mockResolvedValueOnce({ ...tudo, lucro: false });
    expect((await GET()).status).toBe(403);
    m.permissoes.mockResolvedValueOnce({ ...tudo, folha: false, comissao: false });
    expect((await GET()).status).toBe(403);
    expect(podeVerDemonstrativo("RECEPCAO", tudo)).toBe(false);
    expect(podeVerDemonstrativo("BARBEIRO", tudo)).toBe(false);
    expect(podeVerDemonstrativo("LIDER", tudo)).toBe(false);
    expect(podeVerDemonstrativo("GERENTE", { ...tudo, folha: false })).toBe(true);
    expect(podeVerDemonstrativo("DONO", tudo)).toBe(true);
  });
  it("oculta o link e informa ausência quando o arquivo ainda não foi publicado", async () => {
    expect(await demonstrativoDisponivel()).toBe(false);
    expect((await GET()).status).toBe(404);
    vi.stubEnv("DEMONSTRATIVO_RH_ARQUIVO", "");
    expect(await demonstrativoDisponivel()).toBe(false);
    expect((await GET()).status).toBe(404);
  });
});
