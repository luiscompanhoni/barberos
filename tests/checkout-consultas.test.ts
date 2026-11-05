import { describe, expect, it } from "vitest";
import { controlarConsultasCheckout } from "@/components/checkout/consultas";
import type { EstadoCheckout } from "@/lib/pagamentos/checkout-regras";

describe("leituras concorrentes do checkout", () => {
  it.each(["CANCELADO", "PAGO"] as const)("GET antigo não substitui o resultado confirmado %s", async status => {
    const consultas = controlarConsultasCheckout();
    let estado: EstadoCheckout["status"] = "PENDENTE";
    let responder!: (status: EstadoCheckout["status"]) => void;
    const resposta = new Promise<EstadoCheckout["status"]>(resolve => { responder = resolve; });
    const consulta = consultas.iniciarConsulta()!;
    const aplicacao = resposta.then(atual => { if (consulta.atual()) estado = atual; });
    consultas.iniciarMutacao();
    estado = status; // resposta do POST/DELETE confirmada antes do GET anterior
    consultas.terminarMutacao();
    responder("PENDENTE"); await aplicacao;
    expect(estado).toBe(status);
  });
  it("não abre polling enquanto o POST/DELETE está em andamento", () => {
    const consultas = controlarConsultasCheckout();
    consultas.iniciarMutacao();
    expect(consultas.iniciarConsulta()).toBeNull();
    consultas.terminarMutacao();
    expect(consultas.iniciarConsulta()?.atual()).toBe(true);
  });
  it("permite conferência explícita depois de erro da mutação, invalidando a leitura ao terminar", () => {
    const consultas = controlarConsultasCheckout();
    consultas.iniciarMutacao();
    const conferir = consultas.iniciarConsulta(true)!;
    expect(conferir.atual()).toBe(true);
    consultas.terminarMutacao();
    expect(conferir.atual()).toBe(false);
  });
  it("polling mais recente ganha de resposta anterior lenta", () => {
    const consultas = controlarConsultasCheckout();
    const anterior = consultas.iniciarConsulta()!;
    const recente = consultas.iniciarConsulta()!;
    expect(anterior.atual()).toBe(false);
    expect(recente.atual()).toBe(true);
  });
  it("nova tentativa invalida até a consulta recente da operação anterior", () => {
    const consultas = controlarConsultasCheckout();
    consultas.iniciarMutacao(); consultas.terminarMutacao();
    const antiga = consultas.iniciarConsulta()!;
    consultas.iniciarMutacao();
    expect(antiga.atual()).toBe(false);
  });
});
