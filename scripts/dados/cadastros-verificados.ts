/** Planejador puro: nunca une pessoas apenas por telefone ou nome. */
export type Cadastro = { id: string; nome: string; telefone: string | null; cpf: string | null; email: string | null; dataNascimento: string | null };
export type FonteCadastro = Cadastro & { fonte: string };
export const nomeChave = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export function cpfValido(s: string | null): string | null {
  const d = (s ?? "").replace(/\D/g, "");
  if (!/^\d{11}$/.test(d) || /^(.)\1+$/.test(d)) return null;
  for (let k = 9; k < 11; k++) {
    const soma = [...d.slice(0, k)].reduce((t, n, i) => t + Number(n) * (k + 1 - i), 0);
    if ((soma * 10 % 11 % 10) !== Number(d[k])) return null;
  }
  return d;
}
export function telefoneValido(s: string | null): string | null {
  let d = (s ?? "").replace(/\D/g, "");
  if (d.startsWith("55") && d.length > 11) d = d.slice(2);
  if (/^[1-9]\d[6-9]\d{7}$/.test(d)) d = d.slice(0, 2) + "9" + d.slice(2);
  return /^[1-9]\d9\d{8}$/.test(d) ? "55" + d : null;
}
export function emailValido(s: string | null): string | null {
  const e = (s ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254 ? e : null;
}
export function nascimentoValido(s: string | null, hoje = new Date()): string | null {
  const m = s?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const iso = m ? `${m[3]}-${m[2]}-${m[1]}` : s;
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(iso + "T00:00:00Z");
  if (!Number.isFinite(+d) || d.toISOString().slice(0, 10) !== iso) return null;
  const idade = (+hoje - +d) / (365.25 * 86400000);
  return idade >= 5 && idade <= 100 ? iso : null;
}
type Campos = Pick<Cadastro, "cpf" | "email" | "dataNascimento">;
export type Alteracao = { id: string; antes: Cadastro; depois: Campos; fontes: string[] };
export function diferencaAuditavel(a: Alteracao) {
  const antes: Record<string, string | null> = {}, depois: Record<string, string> = {};
  for (const k of ["cpf", "email", "dataNascimento"] as const) {
    const v = a.depois[k]; if (!v) continue;
    const proteger = (s: string | null) => k === "cpf" && s ? `***.***.***-${s.replace(/\D/g, "").slice(-2)}` : s;
    antes[k] = proteger(a.antes[k]); depois[k] = proteger(v)!;
  }
  return { antes, depois };
}
export function planejarCadastros(existentes: Cadastro[], fontes: FonteCadastro[]) {
  const pendencias: { fonte: string; id: string; motivo: string }[] = [];
  const propostas = new Map<string, FonteCadastro[]>();
  const candidatosNovos: FonteCadastro[] = [];
  const atualizacoes: Alteracao[] = [];
  const novos: FonteCadastro[] = [];
  const reter = (r: FonteCadastro, motivo: string) => pendencias.push({ fonte: r.fonte, id: r.id, motivo });
  // Indices incluem todos os registros: repeticao jamais escolhe o primeiro arbitrariamente.
  const por = <T,>(rs: T[], fn: (r: T) => string | null) => {
    const m = new Map<string, T[]>();
    for (const r of rs) { const k = fn(r); if (k) m.set(k, [...(m.get(k) ?? []), r]); }
    return m;
  };
  const cpfEx = por(existentes, r => cpfValido(r.cpf));
  const telEx = por(existentes, r => telefoneValido(r.telefone));
  const emailEx = por(existentes, r => emailValido(r.email));
  const telFonte = por(fontes, r => telefoneValido(r.telefone));
  const cpfFonte = por(fontes, r => cpfValido(r.cpf));
  const nomeEx = por(existentes, r => nomeChave(r.nome));
  for (const r of fontes) {
    const cpf = cpfValido(r.cpf), tel = telefoneValido(r.telefone), email = emailValido(r.email);
    const cp = cpf ? cpfEx.get(cpf) ?? [] : [], tp = tel ? telEx.get(tel) ?? [] : [];
    if (cp.length > 1 || tp.length > 1 || (cp.length && tp.length && cp[0].id !== tp[0].id)) { reter(r, "Identificadores apontam para pessoas diferentes"); continue; }
    const ex = cp[0] ?? tp[0];
    const pares = [...(tel ? telFonte.get(tel) ?? [] : []), ...(cpf ? cpfFonte.get(cpf) ?? [] : [])];
    // Conservador inclusive com CPF: o telefone compartilhado pode representar familiar.
    if (pares.some(p => nomeChave(p.nome) !== nomeChave(r.nome) || (cpfValido(p.cpf) && cpf && cpfValido(p.cpf) !== cpf))) { reter(r, "Telefone ou CPF compartilhado por identidades diferentes"); continue; }
    if (ex) {
      if (nomeChave(ex.nome) !== nomeChave(r.nome) || !nomeChave(r.nome).includes(" ")) { reter(r, "Nome divergente ou incompleto"); continue; }
      if (ex.cpf && r.cpf && (ex.cpf.replace(/\D/g, "") !== r.cpf.replace(/\D/g, ""))) { reter(r, "CPF divergente"); continue; }
      if (email && (emailEx.get(email) ?? []).some(p => p.id !== ex.id)) { reter(r, "E-mail pertence a outro cadastro"); continue; }
      propostas.set(ex.id, [...(propostas.get(ex.id) ?? []), r]);
    } else {
      if (!tel || !nomeChave(r.nome).includes(" ") || nomeEx.has(nomeChave(r.nome))) { reter(r, "Sem telefone unico ou possivel cadastro existente por outro telefone"); continue; }
      candidatosNovos.push(r);
    }
  }
  function campos(rs: FonteCadastro[]): Campos | null {
    const resultado: Campos = { cpf: null, email: null, dataNascimento: null };
    for (const k of ["cpf", "email", "dataNascimento"] as const) {
      const valores = new Set(rs.map(r => k === "cpf" ? cpfValido(r[k]) : k === "email" ? emailValido(r[k]) : nascimentoValido(r[k])).filter((v): v is string => !!v));
      if (valores.size > 1) return null;
      resultado[k] = [...valores][0] ?? null;
    }
    return resultado;
  }
  for (const [id, rs] of propostas) {
    const ex = existentes.find(r => r.id === id)!;
    const c = campos(rs);
    if (!c) { rs.forEach(r => reter(r, "Fontes discordam sobre os campos")); continue; }
    for (const k of ["cpf", "email", "dataNascimento"] as const) if (ex[k]) c[k] = null;
    if (Object.values(c).some(Boolean)) atualizacoes.push({ id, antes: ex, depois: c, fontes: rs.map(r => `${r.fonte}:${r.id}`) });
  }
  for (const [tel, rs] of por(candidatosNovos, r => telefoneValido(r.telefone))) {
    const c = campos(rs);
    const n = nomeChave(rs[0].nome);
    if (!c || candidatosNovos.some(r => nomeChave(r.nome) === n && telefoneValido(r.telefone) !== tel) || (c.email && emailEx.has(c.email))) { rs.forEach(r => reter(r, "Novo cadastro com dados conflitantes")); continue; }
    novos.push({ ...rs[0], ...c, telefone: tel });
  }
  // Evita atribuir o mesmo documento/e-mail a clientes diferentes no mesmo lote.
  for (const campo of ["cpf", "email"] as const) {
    const proprietarios = new Map<string, Set<string>>();
    for (const a of atualizacoes) { const v = a.depois[campo]; if (v) proprietarios.set(v, new Set([...(proprietarios.get(v) ?? []), a.id])); }
    for (const n of novos) { const v = n[campo]; if (v) proprietarios.set(v, new Set([...(proprietarios.get(v) ?? []), `novo:${n.telefone}`])); }
    for (const a of atualizacoes) { const v = a.depois[campo]; if (v && proprietarios.get(v)!.size > 1) { a.depois[campo] = null; pendencias.push({ fonte: "lote", id: a.id, motivo: `${campo} repetido entre destinos` }); } }
    for (let i = novos.length - 1; i >= 0; i--) { const n = novos[i], v = n[campo]; if (v && proprietarios.get(v)!.size > 1) { reter(n, `${campo} repetido entre destinos`); novos.splice(i, 1); } }
  }
  return { atualizacoes: atualizacoes.filter(a => Object.values(a.depois).some(Boolean)), novos, pendencias };
}
