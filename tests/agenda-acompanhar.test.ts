import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acompanharAgenda } from "@/lib/agenda/acompanhar";

class Eventos {
  static atual: Eventos;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  close = vi.fn();
  constructor() { Eventos.atual = this; }
}
let doc: EventTarget & { visibilityState: string };
let win: EventTarget;
beforeEach(() => {
  vi.useFakeTimers();
  doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  win = new EventTarget();
  vi.stubGlobal("document", doc); vi.stubGlobal("window", win); vi.stubGlobal("EventSource", Eventos);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("agenda aberta no celular", () => {
  it("reconcilia ao conectar e reconectar mesmo sem receber o evento original", () => {
    const atualizar = vi.fn(), estado = vi.fn(), parar = acompanharAgenda(atualizar, { aoConectar: estado });
    Eventos.atual.onopen!(); Eventos.atual.onerror!(); Eventos.atual.onopen!();
    expect(atualizar).toHaveBeenCalledTimes(2);
    expect(estado.mock.calls).toEqual([[true], [false], [true]]);
    parar();
  });
  it("agrupa eventos de agenda e ignora outros eventos ou mensagens inválidas", () => {
    const atualizar = vi.fn(), parar = acompanharAgenda(atualizar);
    for (const data of ['{', '{"tipo":"comanda"}', '{"tipo":"agenda"}', '{"tipo":"agenda"}']) Eventos.atual.onmessage!({ data });
    vi.advanceTimersByTime(250);
    expect(atualizar).toHaveBeenCalledTimes(1);
    parar();
  });
  it("consulta periodicamente e ao retornar do segundo plano ou recuperar a rede", () => {
    const atualizar = vi.fn(), parar = acompanharAgenda(atualizar);
    vi.advanceTimersByTime(15_000); expect(atualizar).toHaveBeenCalledTimes(1);
    doc.visibilityState = "hidden"; vi.advanceTimersByTime(30_000);
    expect(atualizar).toHaveBeenCalledTimes(1);
    doc.visibilityState = "visible"; doc.dispatchEvent(new Event("visibilitychange"));
    win.dispatchEvent(new Event("online")); win.dispatchEvent(new Event("focus"));
    expect(atualizar).toHaveBeenCalledTimes(4);
    parar();
    vi.advanceTimersByTime(30_000); win.dispatchEvent(new Event("online")); doc.dispatchEvent(new Event("visibilitychange"));
    expect(atualizar).toHaveBeenCalledTimes(4); expect(Eventos.atual.close).toHaveBeenCalledOnce();
  });
  it("atualiza mesmo quando EventSource não está disponível", () => {
    vi.stubGlobal("EventSource", undefined);
    const atualizar = vi.fn(), parar = acompanharAgenda(atualizar);
    vi.advanceTimersByTime(15_000); expect(atualizar).toHaveBeenCalledOnce(); parar();
  });
});
