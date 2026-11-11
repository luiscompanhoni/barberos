import { describe, expect, it } from "vitest";
import { conferirCelcoin } from "../scripts/lib/conferencia-celcoin";
import { lerFonteMigracao } from "../scripts/lib/conferencia-migracao";

const clientes = lerFonteMigracao('ID,Nome,CPF,Telefone\n1,Pessoa Fictícia,52998224725,11999990100', ["ID", "Telefone"]).linhas;
const contrato = 'Pessoa Fictícia;52998224725;11999990100;Plano de Corte;118,00;Mensal;22;Ativa';
const cabContrato = 'Nome do cliente;Documento do Cliente;Celular do Cliente;Plano;Valor;Periodicidade;Código;Status';
const cabTx = 'Código;Código do Contrato/Venda;Nome do cliente;Documento do Cliente;Celular do Cliente;Plano;Vencimento;Valor;Status;Data do status atual;TID';
const tx = '31;22;Pessoa Fictícia;52998224725;11999990100;Plano de Corte;04/11/2026;118,00;Capturada na Operadora;06/11/2026 - 17:30;tid-ficticio';
const analisar = (linhas = [tx], contratos = [contrato]) => conferirCelcoin(clientes,
  lerFonteMigracao([cabContrato, ...contratos].join("\n"), ["Código"], ";").linhas,
  lerFonteMigracao([cabTx, ...linhas].join("\n"), ["Código"], ";").linhas, "2026-11-11");

describe("conciliação da Celcoin por contrato e ciclo", () => {
  it("preserva vencimento, confirma captura pelo contrato e identifica um vencimento futuro em aberto", () => {
    const r = analisar([tx, tx.replace(/^31/, "32").replace("04/11/2026", "04/12/2026").replace("Capturada na Operadora", "Em aberto")]);
    expect(r.contratos[0]).toMatchObject({ clienteId: "1", contratoId: "22", estado: "PAGAMENTO_CONFIRMADO_CELCOIN",
      vencimento: "2026-11-04", proximoVencimento: "2026-12-04" });
    expect(r.ciclosConfirmadosSemPendenciaAnterior).toBe(1);
  });
  it.each([
    ["Paga fora do sistema", "PAGO_FORA_A_CONFERIR"],
    ["Estornada na Operadora", "ESTORNO_OU_CHARGEBACK"],
    ["Estorno por chargeback", "ESTORNO_OU_CHARGEBACK"],
    ["Negada na Operadora", "VENCIDO_SEM_PAGAMENTO"],
    ["Autorizado", "STATUS_INDEFINIDO"],
  ])("classifica %s sem contar como recebimento confirmado", (status, estado) => {
    const r = analisar([tx.replace("Capturada na Operadora", status)]);
    expect(r.contratos[0].estado).toBe(estado);
    expect(r.ciclosConfirmadosComVinculo).toBe(0);
  });
  it("recusa duplicidade, mudança após o corte, plano ou titular divergente e valor parcial", () => {
    expect(analisar([tx, tx]).contratos[0].estado).toBe("TRANSACAO_A_CONFERIR");
    expect(analisar([tx.replace("06/11/2026", "12/11/2026")]).contratos[0].estado).toBe("TRANSACAO_A_CONFERIR");
    expect(analisar([tx.replace("Pessoa Fictícia", "Outra Pessoa")]).contratos[0].estado).toBe("TRANSACAO_A_CONFERIR");
    expect(analisar([tx.replace("118,00", "58,00")]).contratos[0].estado).toBe("VALOR_DIVERGENTE");
  });
  it("não resolve titulares de telefone compartilhado nem confunde cobrança avulsa com assinatura", () => {
    const r = analisar([tx], [contrato, contrato.replace("Pessoa Fictícia", "Outra Pessoa").replace(";22;", ";23;")]);
    expect(r.ciclosConfirmadosComVinculo).toBe(0);
    expect(r.contratos[0].vinculo).toBe("IDENTIDADE_DIVERGENTE_OU_AMBIGUA");
    expect(analisar([tx], [contrato.replace("Mensal", "Única(Venda)")]).contratos[0].estado).toBe("FORA_DOS_CONTRATOS_ATIVOS");
  });
  it("mantém a pendência anterior e não confunde vencimento no dia com atraso", () => {
    const anterior = tx.replace(/^31/, "40").replace("04/11/2026", "04/10/2026").replace("Capturada na Operadora", "Em aberto");
    const r = analisar([tx, anterior]);
    expect(r.contratos[0].anterioresEmAberto).toBe(1);
    expect(r.ciclosConfirmadosComVinculo).toBe(1);
    expect(r.ciclosConfirmadosSemPendenciaAnterior).toBe(0);
    expect(analisar([anterior.replace("04/10/2026", "11/11/2026")]).contratos[0].estado).toBe("VENCE_NO_CORTE");
  });
  it("separa captura antiga sem ciclo recente, CPF inválido e TID com estorno em outro contrato", () => {
    const antigo = tx.replace("04/11/2026", "04/09/2026").replace("06/11/2026", "06/09/2026");
    expect(analisar([antigo]).contratos[0].estado).toBe("SEM_CICLO_RECENTE_COMPROVADO");
    expect(analisar([tx], [contrato.replace("52998224725", "52998224726")]).contratos[0].vinculo).toBe("IDENTIDADE_DIVERGENTE_OU_AMBIGUA");
    const reversao = tx.replace(/^31;22/, "32;98").replace("Capturada na Operadora", "Estornada na Operadora");
    expect(analisar([tx, reversao]).contratos[0].estado).toBe("TRANSACAO_A_CONFERIR");
    expect(analisar([tx], [contrato.replace("Ativa", "Desconhecido")]).contratosInconsistentes).toBe(1);
  });
});
