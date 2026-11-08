"""Operações locais da publicação. Saídas de subprocessos ficam em arquivo privado."""
import hashlib
import json
import os
import subprocess
import time
import urllib.request
import urllib.error
from pathlib import Path

CONTROLES_PUBLICACAO = {
    "BARBEROS_QUARENTENA_RESTAURACAO": "false",
    "AGENTES_HABILITADOS": "true", "AGENTES_EXECUCAO_ATIVA": "false", "META_ADS_TOKEN": "",
    "RECRUTAMENTO_ENTREVISTAS_WHATSAPP_ATIVO": "false", "WHATSAPP_PILOTO_ENTREVISTAS_HABILITADO": "true",
    "WHATSAPP_ATENDIMENTO_APOS_PILOTO": "false", "WHATSAPP_ATENDIMENTO_IA_PAGA": "false",
    "WHATSAPP_ENVIOS_BLOQUEADOS": "true", "PUSH_PROVIDER": "desativado",
    "COBRANCA_LEGADA_WHATSAPP_ATIVA": "false", "COBRANCA_AUTOMATICA_WHATSAPP_ATIVA": "false",
    "PAGAMENTOS_EMISSAO_AUTOMATICA_PIX_ATIVA": "false",
    # Stone fica manual até homologação/ativação explícita do dono com Luis.
    "MAQUININHA": "manual",
}

MIGRACOES_CLIENTE = {
    "20261104223000_cliente_pedidos_login_planos",
    "20261104224000_verificacao_telefone",
    "20261104224500_versao_sessao",
}


def executar(args, *, entrada=None, ambiente=None, prazo=300):
    r = subprocess.run(args, input=entrada, capture_output=True, env=ambiente, timeout=prazo)
    if r.returncode:
        raise RuntimeError("Comando da etapa não concluiu; saída privada omitida.")
    return r.stdout


def container(projeto, servico):
    ids = executar(["docker", "ps", "-aq", "--filter", "label=com.docker.compose.project=" + projeto, "--filter", "label=com.docker.compose.service=" + servico]).decode().split()
    if len(ids) != 1:
        raise RuntimeError("Serviço esperado ausente ou duplicado.")
    return json.loads(executar(["docker", "inspect", ids[0]]))[0]


def escrever_privado(path, valor):
    with open(path, "x", encoding="utf8", opener=lambda p, f: os.open(p, f, 0o600)) as f:
        f.write(valor)


def ambiente_container(c):
    return dict(item.split("=", 1) for item in c["Config"]["Env"] if "=" in item)


def arquivo_ambiente(path, ambiente):
    if any("\n" in str(v) or "\r" in str(v) for v in ambiente.values()):
        raise RuntimeError("Configuração multiline requer tratamento específico.")
    escrever_privado(path, "".join(k + "=" + v + "\n" for k, v in ambiente.items()))


def consultar_banco(banco, sql, destino="barberos"):
    return executar(["docker", "exec", banco, "psql", "-X", "-U", "barberos", "-d", destino, "-At", "-v", "ON_ERROR_STOP=1", "-c", sql]).decode().strip()


def migracoes(banco):
    sql = "SELECT coalesce(json_agg(json_build_object('nome',migration_name,'checksum',checksum,'aplicada',finished_at IS NOT NULL,'revertida',rolled_back_at IS NOT NULL)),'[]'::json) FROM _prisma_migrations"
    return json.loads(consultar_banco(banco, sql))


def conferir_migracoes(aplicadas, pasta):
    arquivos = {p.parent.name: p for p in pasta.glob("*/migration.sql")}
    nomes = set()
    for m in aplicadas:
        if m["revertida"]:
            continue
        if not m["aplicada"] or m["nome"] not in arquivos or m["nome"] in nomes:
            raise RuntimeError("Histórico de migrações incompatível ou incompleto.")
        nomes.add(m["nome"])
        fonte = arquivos[m["nome"]].read_bytes().replace(b"\r\n", b"\n")
        # Prisma admite ambos os finais de linha; não altera checksum registrado no banco.
        somas = {hashlib.sha256(fonte).hexdigest(), hashlib.sha256(fonte.replace(b"\n", b"\r\n")).hexdigest()}
        if m["checksum"] not in somas:
            raise RuntimeError("Conteúdo de migração aplicada divergente.")
    return sorted(set(arquivos) - nomes)


def exigir_migracoes_da_publicacao(pendentes):
    # Somente as migrações revisadas; executar a publicação ainda exige pedido explícito.
    if set(pendentes) - MIGRACOES_CLIENTE - {"20261102030000_central_agentes", "20261102040000_estudio_templates_roteiros", "20261102180000_recrutamento_formularios", "20261102190000_recrutamento_revisao", "20261102200000_recrutamento_contexto", "20261102210000_recrutamento_entrevistas", "20261102220000_entrevistas_piloto_whatsapp", "20261102221000_piloto_destino_obrigatorio", "20261103143000_agenda_externa_transicao", "20261104120000_campanha_equipe_servicos", "20261104121000_solicitacoes_horario", "20261104121500_solicitacao_horario_periodo", "20261104123000_reunioes_avisos", "20261104130000_planos_vitrine", "20261104131000_avaliacao_mensal_elegibilidade", "20261104132000_cobranca_automatica_tentativas", "20261104133000_webhook_pagamento_entrada", "20261104134000_webhook_pagamento_sequencia", "20261104135000_emissao_pix_mensal", "20261104140000_optout_contato_antes_cadastro", "20261104141000_webhook_pagamento_ordem", "20261103230000_folha_lote_pix_preparacao", "20261103233000_link_intencao_pagamento"}:
        raise RuntimeError("Migração pendente fora do escopo aprovado desta publicação.")


def exigir_agenda_equipe(banco):
    valor = consultar_banco(banco, 'SELECT "agendaExternaAtiva" FROM configuracao WHERE id = 1')
    if valor != "t":
        raise RuntimeError("Agenda principal do Cash Barber sem confirmação pela equipe.")
    return True


# Lê os artefatos da rota standalone. Nunca importa a rota nem executa código da folha.
# O teste funcional do mesmo contrato roda no CI. Mudança de formato do bundle exige revisão.
PROVA_CONTRATO_PIX = r"""
const fs = require("node:fs"), path = require("node:path");
const servidor = path.resolve(".next/server");
const rota = path.join(servidor, "app/api/rh/folha/lote-pix/route.js");
const manifesto = JSON.parse(fs.readFileSync(rota + ".nft.json", "utf8"));
const arquivos = new Set([rota, ...manifesto.files.map(f => path.resolve(path.dirname(rota), f))]);
const valores = [], acoes = [];
for (const arquivo of arquivos) {
  if (!arquivo.startsWith(servidor + path.sep) || !arquivo.endsWith(".js")) continue;
  const texto = fs.readFileSync(arquivo, "utf8");
  for (const m of texto.matchAll(/\benvioHabilitado\s*:\s*([^,}]+)/g)) valores.push(m[1].trim());
  for (const m of texto.matchAll(/\brevisao\s*:[^,{}]+,\s*acao\s*:\s*[\w$.]+\.enum\(\s*\[([^\]]*)\]/g))
    acoes.push(m[1].replace(/\s/g, ""));
}
if (valores.length !== 1 || !["false", "!1"].includes(valores[0]) ||
    acoes.length !== 1 || acoes[0] !== '"preparar","conferir"') process.exit(1);
process.stdout.write("CONTRATO_RH_PIX_BLOQUEADO");
"""


def exigir_contrato_pix_imagem(imagem):
    resposta = executar(["docker", "run", "--rm", "--pull=never", "--network", "none", "--read-only",
                         "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
                         "--workdir", "/app", "--entrypoint", "node", imagem, "-e", PROVA_CONTRATO_PIX], prazo=45)
    if resposta != b"CONTRATO_RH_PIX_BLOQUEADO":
        raise RuntimeError("O contrato compilado da folha não confirmou bloqueio de envio do lote Pix.")
    return True


def conferir_central_desligada(app):
    env = ambiente_container(app)
    for chave, valor in CONTROLES_PUBLICACAO.items():
        if env.get(chave) != valor:
            raise RuntimeError("Controle de publicação não confirmado: " + chave)
    if env.get("AGENTES_HABILITADOS") != "true" or env.get("AGENTES_EXECUCAO_ATIVA") != "false" or env.get("META_ADS_TOKEN") != "":
        raise RuntimeError("A Central não confirmou interface habilitada com execução e conexão Meta desligadas.")
    if env.get("RECRUTAMENTO_ENTREVISTAS_WHATSAPP_ATIVO") != "false":
        raise RuntimeError("Envios de entrevistas não confirmaram estado desligado.")
    if env.get("WHATSAPP_PILOTO_ENTREVISTAS_HABILITADO") != "true":
        raise RuntimeError("Interface do piloto restrito indisponível.")
    return {"habilitada": True, "execucaoAtiva": False, "metaTokenConfigurado": False, "enviosEntrevistasAtivos": False}


def aguardar_saude(projeto, prazo=180):
    limite = time.monotonic() + prazo
    confirmacoes = 0
    while time.monotonic() < limite:
        c = container(projeto, "app")
        if c["State"]["Status"] == "running" and c["State"].get("Health", {}).get("Status") == "healthy":
            confirmacoes += 1
            if confirmacoes >= 3:
                return c
        else:
            confirmacoes = 0
        time.sleep(5)
    raise RuntimeError("Aplicação não manteve saúde estável.")


def conferir_https(revisao):
    with urllib.request.urlopen("https://painel.appblackbarber.com/api/saude", timeout=15) as r:
        dados = json.load(r)
    if dados.get("ok") is not True or dados.get("revisao") != revisao:
        raise RuntimeError("HTTPS não confirmou a revisão publicada.")
    for caminho in ("/api/estudio/projetos", "/api/agentes"):
        try:
            with urllib.request.urlopen("https://painel.appblackbarber.com" + caminho, timeout=15):
                pass
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                continue
        raise RuntimeError("Uma rota privada não recusou acesso anônimo.")


def backup_verificado(base, imagem, rede, ambiente, volume, tipo="DEPLOY", volume_banco=None):
    if not volume_banco:
        raise RuntimeError("Volume do PostgreSQL deve ser identificado antes do backup.")
    antes = set((base / "backups").glob("barberos-*.sql.gz"))
    executar(["docker", "run", "--rm", "--network", rede, "--env-file", str(ambiente),
              "-e", "BACKUP_PG_DATA=/capacidade-postgres", "-v", volume_banco + ":/capacidade-postgres:ro",
              "-v", str(base / "backups") + ":/backups", "-v", volume + ":/media-estudio:ro",
              imagem, "agora", tipo], prazo=600)
    novos = set((base / "backups").glob("barberos-*.sql.gz")) - antes
    if len(novos) != 1:
        raise RuntimeError("Backup da execução não foi identificado inequivocamente.")
    arquivo = novos.pop()
    midia = arquivo.with_name(arquivo.name.removesuffix(".sql.gz") + ".studio.tar.gz")
    manifesto = arquivo.with_name(arquivo.name.removesuffix(".sql.gz") + ".manifesto.json")
    if not midia.is_file() or not manifesto.is_file() or any(p.is_symlink() for p in (arquivo, midia, manifesto)) or arquivo.stat().st_size == 0:
        raise RuntimeError("Backup sem banco, mídia ou manifesto consistente.")
    referencia = json.loads(manifesto.read_text(encoding="utf8"))
    with arquivo.open("rb") as f:
        digest = hashlib.file_digest(f, "sha256").hexdigest()
    if referencia.get("formato") != 1 or referencia.get("snapshotConsistente") is not True or referencia.get("dumpSha256") != digest:
        raise RuntimeError("Manifesto de recuperação não corresponde ao dump.")
    return {"arquivo": str(arquivo), "sha256": digest,
            "midia": str(midia), "manifesto": str(manifesto), "tabelasConferidas": len(referencia["tabelas"]), "restaurado": True}


def ensaiar_schema(banco, backup, nome, rede, env, nova, anterior, pasta):
    executar(["docker", "exec", banco, "createdb", "-U", "barberos", nome])
    try:
        # Destino fixo e exclusivo desta execução; nunca restaura sobre o banco de produção.
        with open(backup, "rb") as entrada:
            r = subprocess.run(["docker", "exec", "-i", banco, "sh", "-c",
                                'set -o pipefail; gunzip | psql -X -U barberos -d "$1" -q -v ON_ERROR_STOP=1', "sh", nome],
                               stdin=entrada, capture_output=True, timeout=180)
        if r.returncode:
            raise RuntimeError("Restauração isolada para ensaio não concluiu.")
        from urllib.parse import urlsplit, urlunsplit
        url = urlsplit(env["DATABASE_URL"])
        destino = urlunsplit((url.scheme, url.netloc, "/" + nome, url.query, url.fragment))
        arquivo = pasta / "ensaio.env"
        arquivo_ambiente(arquivo, {"DATABASE_URL": destino})
        prefixo = ["docker", "run", "--rm", "--network", rede, "--env-file", str(arquivo)]
        executar([*prefixo, nova, "prisma", "migrate", "deploy"], prazo=180)
        executar([*prefixo, nova, "prisma", "migrate", "diff", "--from-schema-datasource", "/app/prisma/schema.prisma", "--to-schema-datamodel", "/app/prisma/schema.prisma", "--exit-code"], prazo=180)
        # Exercita o cliente Prisma anterior no schema novo, sem iniciar cron, webhooks ou servidor web.
        programa = "const {PrismaClient,Prisma}=require('@prisma/client');const db=new PrismaClient();(async()=>{for(const m of Prisma.dmmf.datamodel.models){const select=Object.fromEntries(m.fields.filter(f=>f.kind!=='object').map(f=>[f.name,true]));await db[m.name[0].toLowerCase()+m.name.slice(1)].findFirst({select});}})().then(()=>db.$disconnect()).catch(async()=>{await db.$disconnect();process.exitCode=1;});"
        executar([*prefixo, anterior, "node", "-e", programa], prazo=180)
    finally:
        executar(["docker", "exec", banco, "dropdb", "-U", "barberos", "--if-exists", nome])
        (pasta / "ensaio.env").unlink(missing_ok=True)


def conferir_pacote(pasta, commit):
    manifesto = json.loads((pasta / "versao.json").read_text())
    if manifesto["commit"] != commit:
        raise RuntimeError("Manifesto não corresponde ao commit.")
    codigo = pasta / "barberos"
    for f in manifesto["arquivos"]:
        p = Path(f["caminho"])
        if p.is_absolute() or ".." in p.parts or (codigo / p).is_symlink():
            raise RuntimeError("Caminho inesperado no pacote.")
        if hashlib.sha256((codigo / p).read_bytes()).hexdigest() != f["sha256"]:
            raise RuntimeError("Arquivo do pacote divergente do manifesto.")
    return codigo
