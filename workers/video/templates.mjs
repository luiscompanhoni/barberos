import templates from "./templates.json" with { type: "json" };

export function template(preset) {
  if (!Object.hasOwn(templates, preset)) throw new Error("Template inválido.");
  return templates[preset];
}
export function validarTitulos(snapshot) {
  template(snapshot.preset);
  if (snapshot.preset === "black-vertical-v1") return;
  for (const key of ["titulo", "chamada"]) {
    if (typeof snapshot[key] !== "string" || snapshot[key].length > 70) throw new Error("Título ou chamada inválida.");
  }
}
/** HTML fechado: mídia local e texto escapado; nunca aceita código gerado pelo agente. */
export function composicao1080(clipes, snapshot, escapar) {
  validarTitulos(snapshot);
  const texto = s => escapar(s.replace(/\s+/g, " ").trim());
  let tempo = 0;
  const cenas = clipes.map((c, i) => {
    const inicio = tempo; const duracao = c.fim - c.inicio; tempo += duracao;
    return `<video id="video-${i}" class="clip video" src="assets/${i}.mp4" data-start="${inicio}" data-duration="${duracao}" data-track-index="0" playsinline ${c.audio ? 'data-has-audio="true"' : "muted"}></video>` +
      (c.texto ? `<div id="texto-${i}" class="clip legenda${c.texto.length > 65 ? " longa" : ""}" data-start="${inicio}" data-duration="${duracao}" data-track-index="1"><span>${texto(c.texto)}</span></div>` : "");
  }).join("");
  const estilo = snapshot.preset === "black-recrutamento-v2" ? "recrutamento" : snapshot.preset === "black-equipe-v2" ? "equipe" : "servicos";
  const titulo = snapshot.titulo ? `<div class="titulo${snapshot.titulo.length > 45 ? " longa" : ""}">${texto(snapshot.titulo)}</div>` : "";
  const chamada = snapshot.chamada ? `<div id="chamada" class="clip chamada" data-start="${Math.max(0, tempo - 3)}" data-duration="${Math.min(3, tempo)}" data-track-index="3">${texto(snapshot.chamada)}</div>` : "";
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Black Estúdio</title><style>
*{box-sizing:border-box}html,body{margin:0;width:1080px;height:1920px;overflow:hidden;background:#101010;font-family:Arial,sans-serif}
#black{position:relative;width:1080px;height:1920px;overflow:hidden;background:#101010;color:#fff}
.video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0}
.sombra{position:absolute;inset:0;background:linear-gradient(180deg,rgba(8,8,8,.88),transparent 45%,rgba(8,8,8,.93));pointer-events:none;z-index:1}
.marca,.titulo,.legenda,.chamada{z-index:2}
.marca{position:absolute;left:90px;top:210px;color:#edd8a1;font-size:32px;letter-spacing:10px;font-weight:800;border-top:3px solid #c4a86a;padding-top:22px}
.titulo{position:absolute;top:310px;left:90px;width:830px;max-height:350px;font-size:64px;line-height:1.08;letter-spacing:-2px;font-weight:800;white-space:pre-wrap;overflow-wrap:anywhere}
.legenda{position:absolute;left:90px;right:160px;top:1090px;height:300px;display:flex;align-items:flex-end;font-size:48px;font-weight:700;line-height:1.16;white-space:pre-wrap;overflow-wrap:anywhere}
.legenda span{max-width:100%;padding:24px 28px;background:rgba(10,10,10,.82);border-left:4px solid #c4a86a}
.chamada{position:absolute;left:90px;right:160px;top:1450px;min-height:100px;max-height:200px;padding:24px 28px;background:#c4a86a;color:#101010;font-size:35px;line-height:1.15;font-weight:800;white-space:pre-wrap;overflow-wrap:anywhere}
.recrutamento .titulo{font-size:72px;max-height:400px}.recrutamento .marca{border-top:0;border-left:4px solid #c4a86a;padding:12px 24px}.recrutamento .legenda span{border-left:0;border-top:4px solid #c4a86a}
.servicos .titulo{font-size:56px;max-width:700px}.servicos .marca{font-size:30px}.servicos .legenda span{background:transparent;padding-left:0;border:0;text-shadow:0 2px 14px #000}
.equipe .titulo{font-weight:400;font-size:64px;font-family:Georgia,serif;letter-spacing:0}.equipe .marca{border-top:0;border-bottom:2px solid #c4a86a;padding:0 0 20px}.equipe .chamada{background:rgba(10,10,10,.85);color:#edd8a1;border:2px solid #c4a86a}
#black .titulo.longa{font-size:48px;line-height:1.12;letter-spacing:-1px}#black .legenda.longa{font-size:36px}
</style></head><body><div id="black" class="${estilo}" data-composition-id="black" data-width="1080" data-height="1920" data-duration="${tempo}" data-fps="30" data-no-timeline>${cenas}<div class="sombra"></div><div class="marca">BLACK</div>${titulo}${chamada}</div></body></html>`;
}
