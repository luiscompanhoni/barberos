import { test } from "node:test";
import assert from "node:assert/strict";
import { composicao1080, template, validarTitulos } from "../templates.mjs";
import { escapar } from "../render.mjs";
import { temposValidos } from "../tempos.mjs";

for (const preset of ["black-recrutamento-v2", "black-servicos-v2", "black-equipe-v2"]) {
  test(`${preset}: dimensões, cenas, chamada final e textos inertes`, () => {
    const html = composicao1080([{ inicio: 1, fim: 5, audio: true, texto: '<img src="https://evil.test" onerror="x()">' }, { inicio: 0, fim: 2, texto: "Final", audio: false }], { preset, titulo: "<script>titulo</script>", chamada: "Contato & equipe" }, escapar);
    assert.ok(html.includes('data-width="1080" data-height="1920" data-duration="6"'));
    assert.ok(html.includes('id="chamada" class="clip chamada" data-start="3" data-duration="3"'));
    assert.ok(html.includes('data-start="4" data-duration="2"'));
    assert.ok(!/<script|<img|onerror="/.test(html));
    assert.ok(html.includes("&lt;script&gt;")); assert.ok(html.includes("Contato &amp; equipe"));
    assert.ok(html.includes('data-has-audio="true"')); assert.ok(html.includes("muted"));
    assert.deepEqual([template(preset).largura, template(preset).altura], [1080, 1920]);
  });
}
test("template e títulos arbitrários não são executáveis", () => {
  assert.throws(() => template("__proto__")); assert.throws(() => template("https://evil.test"));
  assert.throws(() => validarTitulos({ preset: "black-equipe-v2", titulo: "a".repeat(71), chamada: "" }));
  assert.throws(() => validarTitulos({ preset: "black-equipe-v2", titulo: {}, chamada: "" }));
});
test("legado conserva resolução e snapshot sem novos campos", () => {
  assert.doesNotThrow(() => validarTitulos({ preset: "black-vertical-v1" }));
  assert.deepEqual([template("black-vertical-v1").largura, template("black-vertical-v1").altura], [720, 1280]);
});
test("texto extenso usa fonte menor e quebras não invadem outras áreas", () => {
  const html = composicao1080([{ inicio: 0, fim: 2, texto: "W\n".repeat(50), audio: false }], { preset: "black-recrutamento-v2", titulo: "W".repeat(70), chamada: "Entre\nem contato" }, escapar);
  assert.ok(html.includes('class="titulo longa"')); assert.ok(html.includes('class="clip legenda longa"'));
  assert.ok(html.includes("Entre em contato")); assert.ok(!html.includes("W\nW"));
});
test("cortes decimais válidos passam, duração curta/excessiva não", () => {
  assert.equal(temposValidos([{ inicio: 0.2, fim: 0.3 }]), true);
  assert.equal(temposValidos([{ inicio: 0.2, fim: 0.299 }]), false);
  assert.equal(temposValidos([{ inicio: 0, fim: 120.001 }]), false);
  assert.equal(temposValidos([{ inicio: 0, fim: Infinity }]), false);
  assert.equal(temposValidos([null]), false);
});
