import { createHash } from "node:crypto";
import { z } from "zod";
import { cpfValido } from "@/lib/assinaturas/regras";

function cnpjValido(d: string) {
  if (!/^\d{14}$/.test(d) || /^(\d)\1+$/.test(d)) return false;
  const digito = (base: string) => {
    let peso = 2;
    const soma = [...base].reverse().reduce((t, n) => { const v = Number(n) * peso; peso = peso === 9 ? 2 : peso + 1; return t + v; }, 0);
    return soma % 11 < 2 ? 0 : 11 - soma % 11;
  };
  return digito(d.slice(0, 12)) === Number(d[12]) && digito(d.slice(0, 13)) === Number(d[13]);
}

/** Formato local, sem consulta ou comprovação de titularidade no banco. */
export function analisarChavePix(entrada: string | null) {
  const original = (entrada ?? "").trim(), digitos = original.replace(/[.\-/]/g, "");
  let tipo: "CPF" | "CNPJ" | "EMAIL" | "TELEFONE" | "ALEATORIA" | null = null;
  let normalizada = original;
  if (/^[\d.\-/]+$/.test(original) && cpfValido(digitos)) { tipo = "CPF"; normalizada = digitos; }
  else if (/^[\d.\-/]+$/.test(original) && cnpjValido(digitos)) { tipo = "CNPJ"; normalizada = digitos; }
  else if (z.email().safeParse(original).success && original.length <= 77) { tipo = "EMAIL"; normalizada = original.toLowerCase(); }
  else if (/^\+[1-9]\d{9,14}$/.test(original)) tipo = "TELEFONE";
  else if (/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(original)) { tipo = "ALEATORIA"; normalizada = original.toLowerCase(); }
  return { tipo, normalizada, hash: createHash("sha256").update(normalizada).digest("hex"),
    mascarada: original ? `••••${normalizada.slice(-4)}` : "Não cadastrada",
    problema: !original ? "Chave Pix ausente." : !tipo ? "Formato da chave inválido. Para telefone, use + e código do país." : null };
}
