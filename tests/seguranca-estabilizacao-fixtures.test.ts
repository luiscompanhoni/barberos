import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validarImportacaoCashbarber } from "../scripts/lib/importacao-cashbarber";
const exemplo = JSON.parse(readFileSync(new URL("../scripts/dados/cashbarber.json", import.meta.url), "utf8"));
const local = { exemplo: true, arquivoExplicito: false, databaseUrl: "postgresql://fixture@127.0.0.1:55447/barberos_teste_fixture" };

describe("origem de dados não se confunde com importação real", () => {
  it("fixture só contém identificadores não discáveis, sem criar um dono", () => {
    expect(exemplo.tipoDados).toBe("SINTETICOS");
    expect(validarImportacaoCashbarber(exemplo, local).barbeiros.every(b => /^sintetico-\d{3}$/.test(b.telefone) && !b.dono)).toBe(true);
  });
  it.each([false, true])("nem arquivo explícito permite tratar fixture como exportação real: %s", arquivoExplicito => {
    expect(() => validarImportacaoCashbarber(exemplo, { ...local, exemplo: false, arquivoExplicito })).toThrow("fixture");
  });
  it.each(["postgresql://fixture@db.example.test/barberos_teste_fixture", "postgresql://fixture@127.0.0.1/barberos", "postgresql://fixture@localhost/producao", "", "https://localhost/barberos_teste_fixture"])("exemplo recusa destino inseguro %s", databaseUrl => {
    expect(() => validarImportacaoCashbarber(exemplo, { ...local, databaseUrl })).toThrow();
  });
  it("exemplo recusa contato discável e criação de dono mesmo se arquivo foi alterado", () => {
    const copia = structuredClone(exemplo); copia.barbeiros[0].telefone = "5511000000000";
    expect(() => validarImportacaoCashbarber(copia, local)).toThrow("não discáveis");
    copia.barbeiros[0].telefone = "sintetico-001"; copia.barbeiros[0].dono = true;
    expect(() => validarImportacaoCashbarber(copia, local)).toThrow("não pode criar donos");
  });
  it("exportação real precisa marcação e arquivo privado explícitos", () => {
    const real = { ...exemplo, tipoDados: "EXPORTACAO_REAL" };
    expect(() => validarImportacaoCashbarber(real, { ...local, exemplo: false })).toThrow();
    expect(validarImportacaoCashbarber(real, { ...local, exemplo: false, arquivoExplicito: true }).tipoDados).toBe("EXPORTACAO_REAL");
    expect(() => validarImportacaoCashbarber(real, local)).toThrow("somente dados sintéticos");
  });
});
