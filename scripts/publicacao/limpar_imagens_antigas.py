"""Remove imagens antigas do BarberOS sem container, mantendo a versão no ar e as anteriores para retorno.

Cada publicação deixa ~2 GB de imagens (app, backup e worker de vídeo). Sem limpeza, o disco
fica abaixo da reserva que a publicação exige para backup, ensaio e troca.

Por padrão só lista. Com --remover, apaga por tag (sem forçar: o Docker recusa imagem em uso) e
confere que containers, volumes, imagens mantidas, .env e backups continuam iguais.
"""
import hashlib
import json
import re
import shutil
import subprocess
from pathlib import Path

REPOSITORIOS = ("barberos-app", "barberos-backup", "barberos-video-worker")
SHA = re.compile(r"[a-f0-9]{40}")
MANTER_ANTERIORES = 2


def executar(args):
    r = subprocess.run(args, capture_output=True, text=True, timeout=180, check=False)
    if r.returncode:
        raise RuntimeError("Comando do Docker não concluiu.")
    return r.stdout


def commit_da_tag(tag):
    """Commit de uma tag de publicação (`<sha>` ou `antes-<sha>`), ou None se não for do BarberOS."""
    bruto = tag[len("antes-"):] if tag.startswith("antes-") else tag
    return bruto if SHA.fullmatch(bruto) else None


def escolher(imagens, em_uso, commit_atual):
    """Separa o que pode sair.

    imagens: [{"repo", "tag", "id", "criada" (texto ISO, ordenável), "bytes"}]
    em_uso: ids de imagem usados por qualquer container (rodando ou parado).
    Mantém: tudo em uso, tudo do commit no ar, as tags das MANTER_ANTERIORES publicações mais
    recentes além dele e a cópia `antes-` mais recente de cada repositório (retorno da última troca).
    """
    nossas = [i for i in imagens if i["repo"] in REPOSITORIOS and commit_da_tag(i["tag"])]
    publicadas = {}
    for i in nossas:
        if not i["tag"].startswith("antes-"):
            c = i["tag"]
            publicadas[c] = max(publicadas.get(c, ""), i["criada"])
    recentes = [c for c, _ in sorted(publicadas.items(), key=lambda x: x[1], reverse=True) if c != commit_atual]
    manter_commits = {commit_atual, *recentes[:MANTER_ANTERIORES]}
    ultima_copia = {}
    for i in nossas:
        if i["tag"].startswith("antes-") and i["criada"] > ultima_copia.get(i["repo"], ("", None))[0]:
            ultima_copia[i["repo"]] = (i["criada"], i["tag"])
    manter, remover = [], []
    for i in nossas:
        motivo = None
        if i["id"] in em_uso:
            motivo = "em uso"
        elif commit_da_tag(i["tag"]) in manter_commits and not i["tag"].startswith("antes-"):
            motivo = "versão no ar ou recente"
        elif i["tag"].startswith("antes-") and ultima_copia.get(i["repo"], (None, None))[1] == i["tag"]:
            motivo = "cópia de retorno mais recente"
        (manter if motivo else remover).append({**i, "motivo": motivo})
    ids_mantidos = {i["id"] for i in manter}
    # Uma tag removida que divide o id com uma mantida só desmarca o nome: não libera espaço, mas é inofensiva.
    for i in remover:
        i["liberaEspaco"] = i["id"] not in ids_mantidos
    return {"manterCommits": sorted(manter_commits), "manter": manter, "remover": remover}


def listar_imagens():
    linhas = executar(["docker", "image", "ls", "--no-trunc", "--format", "{{json .}}"]).splitlines()
    out = []
    for linha in linhas:
        d = json.loads(linha)
        if d.get("Repository") in REPOSITORIOS and d.get("Tag") not in (None, "<none>"):
            info = json.loads(executar(["docker", "image", "inspect", d["ID"]]))[0]
            out.append({"repo": d["Repository"], "tag": d["Tag"], "id": d["ID"], "criada": info["Created"], "bytes": info["Size"]})
    return out


def estado_preservado(base, manter_ids):
    backups = base / "backups"
    if base.is_symlink() or backups.is_symlink() or not backups.is_dir():
        raise RuntimeError("Diretório de backup inesperado.")
    arquivos = [base / ".env", *backups.glob("*.sql.gz"), *backups.glob("*.studio.tar.gz"), *backups.glob("*.manifesto.json")]
    if (base / ".env.estudio").exists():
        arquivos.append(base / ".env.estudio")
    if any(p.is_symlink() or not p.is_file() for p in arquivos):
        raise RuntimeError("Arquivo preservado inesperado.")
    ids = set(executar(["docker", "image", "ls", "-q", "--no-trunc"]).split())
    return {
        "containers": set(executar(["docker", "ps", "-a", "--no-trunc", "--format", "{{.ID}} {{.Image}} {{.State}}"]).splitlines()),
        "volumes": set(executar(["docker", "volume", "ls", "-q"]).splitlines()),
        "imagensMantidas": manter_ids <= ids,
        "arquivos": {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in arquivos},
    }


def limpar(base, projeto, imagem, remover=False):
    ids = executar(["docker", "ps", "-q", "--filter", "label=com.docker.compose.project=" + projeto,
                    "--filter", "label=com.docker.compose.service=app"]).split()
    if len(ids) != 1:
        raise RuntimeError("Aplicação atual não confirmada.")
    app = json.loads(executar(["docker", "inspect", ids[0]]))[0]
    if app["Image"] != imagem or app["State"].get("Health", {}).get("Status") != "healthy":
        raise RuntimeError("Versão ou saúde mudou; nada removido.")
    atual = json.loads(executar(["docker", "image", "inspect", imagem]))[0]
    commit_atual = (atual["Config"].get("Labels") or {}).get("org.opencontainers.image.revision", "")
    if not SHA.fullmatch(commit_atual):
        raise RuntimeError("Commit da versão no ar não identificado; nada removido.")
    # Id da imagem de todo container, rodando ou parado (o inspect do container traz o id, não o nome).
    containers = executar(["docker", "ps", "-aq", "--no-trunc"]).split()
    em_uso_ids = {c["Image"] for c in json.loads(executar(["docker", "inspect", *containers]))} if containers else set()
    em_uso_ids.add(imagem)
    plano = escolher(listar_imagens(), em_uso_ids, commit_atual)
    livre_antes = shutil.disk_usage(base).free
    resumo = lambda lista: [{k: i[k] for k in ("repo", "tag", "id", "bytes", "motivo") if k in i} for i in lista]
    r = {"commitNoAr": commit_atual, "manterCommits": plano["manterCommits"], "livreAntes": livre_antes,
         "manter": resumo(plano["manter"]), "remover": resumo(plano["remover"]),
         "estimativaLiberadaBytes": sum(i["bytes"] for i in plano["remover"] if i["liberaEspaco"]), "removido": False}
    if not remover or not plano["remover"]:
        r["livreDepois"] = livre_antes
        return r
    manter_ids = {i["id"] for i in plano["manter"]}
    antes = estado_preservado(base, manter_ids)
    for i in plano["remover"]:
        executar(["docker", "image", "rm", f"{i['repo']}:{i['tag']}"])
    depois = estado_preservado(base, manter_ids)
    if antes["containers"] != depois["containers"] or antes["volumes"] != depois["volumes"] or not depois["imagensMantidas"] \
            or antes["arquivos"] != depois["arquivos"]:
        raise RuntimeError("Preservação não confirmada após remover imagens; publicação bloqueada.")
    r.update(removido=True, livreDepois=shutil.disk_usage(base).free, containersPreservados=True,
             volumesPreservados=True, imagensMantidasPreservadas=True, backupsConfiguracaoPreservados=True)
    return r


if __name__ == "__main__":
    import argparse
    import fcntl
    import os
    parser = argparse.ArgumentParser()
    parser.add_argument("base")
    parser.add_argument("projeto")
    parser.add_argument("imagem")
    parser.add_argument("--remover", action="store_true")
    args = parser.parse_args()
    base = Path(args.base)
    if os.geteuid() != 0 or not re.fullmatch(r"/[A-Za-z0-9_/-]+", args.base) or ".." in base.parts \
            or not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", args.projeto) or not re.fullmatch(r"sha256:[a-f0-9]{64}", args.imagem):
        raise SystemExit("Parâmetros inválidos.")
    trava = base / ".publicacao.lock"
    if trava.is_symlink():
        raise SystemExit("Trava inesperada.")
    with open(trava, "a") as f:
        fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        print(json.dumps(limpar(base, args.projeto, args.imagem, args.remover)))
