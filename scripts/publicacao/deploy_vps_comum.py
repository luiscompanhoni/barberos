"""Operações locais da publicação. Saídas de subprocessos ficam em arquivo privado."""
import hashlib
import json
import os
import subprocess
import time
import urllib.request
import urllib.error
from pathlib import Path


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
    try:
        urllib.request.urlopen("https://painel.appblackbarber.com/api/estudio/projetos", timeout=15)
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            return
    raise RuntimeError("A rota privada do Estúdio não recusou acesso anônimo.")


def backup_verificado(base, imagem, rede, ambiente, volume):
    antes = set((base / "backups").glob("barberos-*.sql.gz"))
    executar(["docker", "run", "--rm", "--network", rede, "--env-file", str(ambiente),
              "-v", str(base / "backups") + ":/backups", "-v", volume + ":/media-estudio:ro",
              imagem, "agora", "ANTES_DEPLOY"], prazo=600)
    novos = set((base / "backups").glob("barberos-*.sql.gz")) - antes
    if len(novos) != 1:
        raise RuntimeError("Backup da execução não foi identificado inequivocamente.")
    arquivo = novos.pop()
    midia = arquivo.with_name(arquivo.name.removesuffix(".sql.gz") + ".studio.tar.gz")
    if not midia.is_file() or arquivo.stat().st_size == 0:
        raise RuntimeError("Par de backup do banco e mídia incompleto.")
    return {"arquivo": str(arquivo), "sha256": hashlib.sha256(arquivo.read_bytes()).hexdigest(),
            "midia": str(midia), "restaurado": True}


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
