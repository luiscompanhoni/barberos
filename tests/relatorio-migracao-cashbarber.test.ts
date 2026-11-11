import { describe, expect, it } from "vitest";
import { conferirAssinantes, conferirCadastros, lerFonteMigracao } from "../scripts/lib/conferencia-migracao";

const cliente = {
  id: "cliente-demo", nome: "Pessoa Teste", telefone: "5511999990100", cpf: null,
  email: "teste@example.invalid", dataNascimento: "1992-02-29", observacoes: null, excluidoEm: null,
};
const assinatura = {
  id: "assinatura-demo", clienteId: cliente.id, plano: "Plano de Corte", status: "ATIVA", gatewayId: "cashbarber:5:cliente-demo",
  proximoVencimento: "2026-11-30", ultimoPagamento: "2026-10-31",
};
const colunas = "Cliente,Plano,Status,Telefone,Próximo vencimento,Último pagamento,ID da assinatura";
const dados = "Pessoa Teste,Plano de Corte,Em dia,11999990100,30/11/2026,31/10/2026,cb-demo";
const analisar = (linhas: string, contratos: Parameters<typeof conferirAssinantes>[2] = [assinatura]) =>
  conferirAssinantes(lerFonteMigracao(linhas, ["Cliente", "Plano", "Status"]).linhas, [cliente], contratos);

describe("conferência de clientes do CashBarber", () => {
  it("atribui referência inclusive a registros incompletos, telefone compartilhado ou cadastro ausente", () => {
    const csv = [
      '"ID","Nome","Telefone","Email","Data de nascimento"',
      '"a","Pessoa Teste","11999990100","teste@example.invalid","29/02/1992"',
      '"b","Pessoa Familiar","11999990100","",""',
      '"c","Pessoa Sem Cadastro","11999990101","",""',
      '"d","Pessoa Teste","","",""',
      '"e","Linha truncada"',
    ].join("\r\n");
    const resultado = conferirCadastros(lerFonteMigracao(csv, ["Nome", "Telefone"]).linhas, [cliente]);
    expect(resultado.map(l => l.linha)).toEqual([2, 3, 4, 5, 6]);
    expect(resultado.map(l => l.clienteId)).toEqual([null, null, null, null, null]);
    expect(resultado.map(l => l.pendencias)).toEqual([
      ["Identificador repetido na origem"], ["Identificador repetido na origem"], ["Cadastro não localizado"],
      ["Telefone inválido ou ausente na origem", "Vínculo por nome exige confirmação"], ["Colunas inconsistentes"],
    ]);
  });

  it("compara somente dados comprováveis e preserva campos com vírgula, aspas e quebra de linha", () => {
    const csv = 'Nome,Telefone,Email,Data de nascimento,Observação\n"Pessoa Teste",11999990100,teste@example.invalid,31/02/1992,"dois campos,\ncom ""aspas"""';
    const fonte = lerFonteMigracao(csv, ["Nome", "Telefone"]);
    expect(fonte.linhas[0].colunas?.observacao).toBe('dois campos,\ncom "aspas"');
    expect(conferirCadastros(fonte.linhas, [cliente])).toEqual([
      { linha: 2, origemId: null, clienteId: cliente.id, pendencias: ["Nascimento a conferir"] },
    ]);
    expect(() => lerFonteMigracao('Nome,Telefone\n"não fechado', ["Nome", "Telefone"])).toThrow(/aspas não fechadas/);
  });
});

describe("conferência de contratos do CashBarber", () => {
  it("registra os quatro estados conhecidos e deixa a linha antiga apenas nominal para revisão", () => {
    const legado = '"Cliente","Plano","Status","Data de criação"\n"Pessoa Teste","Plano de Corte","Pix aguardando","03/01/2024"';
    expect(analisar(legado)[0]).toMatchObject({
      statusOrigem: null, assinaturaId: null, vencimentoOrigem: null,
      pendencias: ["ID do contrato ausente na origem", "Situação da origem não reconhecida", "Próximo vencimento ausente ou inválido na origem", "Vínculo por nome exige confirmação"],
    });
    expect(["Em dia", "Inadimplente", "Aguardando primeiro pagamento", "Cancelada"].map(status => analisar(`${colunas}\n${dados.replace("Em dia", status)}`)[0].statusOrigem)).toEqual(["ATIVA", "ATRASADA", "PENDENTE", "CANCELADA"]);
  });

  it("confere plano, status, vencimento e pagamento sem confundir datas", () => {
    expect(analisar(`${colunas}\n${dados}`)[0]).toMatchObject({ assinaturaId: assinatura.id, statusOrigem: "ATIVA", vencimentoOrigem: "2026-11-30", pendencias: [] });
    expect(analisar(`${colunas}\n${dados}`, [{ ...assinatura, status: "ATRASADA", plano: "Outro", proximoVencimento: "2026-12-01", ultimoPagamento: null }])[0].pendencias).toEqual([
      "Plano divergente", "Situação divergente", "Próximo vencimento divergente", "Último pagamento divergente",
    ]);
  });

  it("trata duplicatas e históricos sintéticos sem aceitar uma assinatura por aproximação", () => {
    const repetidas = analisar(`${colunas}\n${dados}\n${dados}`);
    expect(repetidas.map(l => l.pendencias)).toEqual(Array.from({ length: 2 }, () => ["Contrato repetido na origem", "Várias linhas apontam para o mesmo contrato no BarberOS"]));
    expect(analisar(`${colunas}\n${dados}`, [assinatura, { ...assinatura, id: "outro" }])[0].pendencias).toEqual(["Múltiplos contratos no BarberOS"]);
    expect(analisar(`${colunas}\n${dados.replace("Em dia", "Cancelada")}`, [{ ...assinatura, status: "CANCELADA", gatewayId: "cashbarber:hist:demo" }])[0].pendencias).toEqual(["Contrato não localizado no BarberOS"]);
  });

  it("bloqueia identificação quando um telefone está presente para dois titulares na fonte", () => {
    const r = analisar(`${colunas}\n${dados}\n${dados.replace("Pessoa Teste", "Pessoa Familiar").replace("cb-demo", "cb-outro")}`);
    expect(r.map(l => l.assinaturaId)).toEqual([null, null]);
    expect(r.every(l => l.pendencias.includes("Identificador compartilhado por titulares diferentes na origem"))).toBe(true);
  });
});
