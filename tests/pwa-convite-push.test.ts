import { describe, expect, it } from "vitest";
import { podeConvidarPush } from "@/lib/pwa/convite-push";
const app = { carregado: true, instalado: true, ios: true, seguro: true, podeInstalar: false, recusado: false };
describe("convite de notificações", () => {
  it("convida no aplicativo instalado com permissão ainda não decidida", () => {
    expect(podeConvidarPush(app, "default", 0, 100)).toBe(true);
  });
  it("não insiste com bloqueio nativo nem em aparelho sem suporte", () => {
    expect(podeConvidarPush(app, "denied", 0, 100)).toBe(false);
    expect(podeConvidarPush(app, "indisponivel", 0, 100)).toBe(false);
  });
  it("no iPhone só oferece depois de instalar e abrir o ícone", () => {
    expect(podeConvidarPush({ ...app, instalado: false }, "default", 0, 100)).toBe(false);
    expect(podeConvidarPush({ ...app, ios: false, instalado: false }, "default", 0, 100)).toBe(true);
  });
  it("respeita adiamento e só volta a oferecer quando ele vencer", () => {
    expect(podeConvidarPush(app, "default", 200, 100)).toBe(false);
    expect(podeConvidarPush(app, "default", 200, 201)).toBe(true);
  });
  it("aguarda hidratação e exige origem segura", () => {
    expect(podeConvidarPush({ ...app, carregado: false }, "default", 0, 100)).toBe(false);
    expect(podeConvidarPush({ ...app, seguro: false }, "default", 0, 100)).toBe(false);
  });
  it("permite corrigir inscrição perdida mesmo com permissão previamente concedida", () => {
    expect(podeConvidarPush(app, "granted", 0, 100)).toBe(true);
  });
});
