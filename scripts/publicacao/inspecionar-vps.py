"""Inventário somente de leitura. Não imprime env, logs de aplicações ou dados de clientes."""
import argparse
import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
from pathlib import Path


def executar(args):
    try:
        r = subprocess.run(args, capture_output=True, text=True, timeout=25, check=False)
        return r.stdout if r.returncode == 0 else None
    except (OSError, subprocess.TimeoutExpired):
        return None


def resumir_container(c):
    config = c.get("Config") or {}
    labels = config.get("Labels") or {}
    estado = c.get("State") or {}
    return {
        "id": c.get("Id", "")[:12], "servico": labels.get("com.docker.compose.service"),
        "estado": estado.get("Status"), "saude": (estado.get("Health") or {}).get("Status"),
        "imagem": c.get("Image"), "tag": config.get("Image"),
        "revisaoDeclarada": labels.get("org.opencontainers.image.revision"),
        "diretorioCompose": labels.get("com.docker.compose.project.working_dir"),
        "arquivosCompose": labels.get("com.docker.compose.project.config_files"),
        "reinicios": c.get("RestartCount"),
        "redes": list((c.get("NetworkSettings") or {}).get("Networks", {})),
        "montagens": [{"tipo": m.get("Type"), "origem": m.get("Name") if m.get("Type") == "volume" else m.get("Source"), "destino": m.get("Destination")} for m in c.get("Mounts", [])],
    }


def arquivos_codigo(base):
    """Hashes do código, sem conteúdo de configuração privada ou diretórios de dados."""
    caminhos = [base / nome for nome in ("Dockerfile", "package.json", "package-lock.json", "next.config.ts", "docker-compose.yml", ".dockerignore")]
    for raiz in ("src", "prisma", "deploy", "scripts", "workers/video"):
        pasta = base / raiz
        if pasta.is_symlink() or not pasta.is_dir():
            continue
        for diretorio, pastas, arquivos in os.walk(pasta, followlinks=False):
            pastas[:] = [nome for nome in pastas if nome not in {"node_modules", "backups", ".git", ".next", "jobs"} and not (Path(diretorio) / nome).is_symlink()]
            for nome in arquivos:
                p = Path(diretorio) / nome
                if nome == "Dockerfile" or (not nome.startswith(".") and p.suffix in {".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".prisma", ".sql", ".yml", ".css", ".sh", ".py"}):
                    caminhos.append(p)
    resultado = []
    for p in sorted(set(caminhos)):
        if p.is_file() and not p.is_symlink():
            if p.stat().st_size > 16 * 1024 * 1024 or len(resultado) >= 3000:
                raise ValueError("Inventário de fonte acima do limite")
            resultado.append({"caminho": str(p.relative_to(base)), "sha256": hashlib.sha256(p.read_bytes()).hexdigest()})
    return resultado


def inspecionar(base, projeto):
    relatorio = {"formato": 1, "somenteLeitura": True, "sistema": platform.system(), "projeto": projeto, "baseExiste": base.is_dir(), "bloqueios": []}
    relatorio["cpuLogicas"] = os.cpu_count()
    relatorio["carga"] = list(os.getloadavg()) if hasattr(os, "getloadavg") else None
    memoria = {}
    try:
        for linha in Path("/proc/meminfo").read_text().splitlines():
            nome, valor = linha.split(":", 1)
            if nome in {"MemTotal", "MemAvailable", "SwapTotal", "SwapFree"}:
                memoria[nome] = int(valor.strip().split()[0]) * 1024
    except (OSError, ValueError):
        relatorio["bloqueios"].append("Memória não consultada.")
    relatorio["memoriaBytes"] = memoria
    disco = shutil.disk_usage(base if base.exists() else "/")
    relatorio["discoBytes"] = {"total": disco.total, "livre": disco.free}
    relatorio["configuracaoExiste"] = (base / ".env").is_file()
    relatorio["composeExiste"] = (base / "deploy/docker-compose.yml").is_file()
    relatorio["arquivosCodigo"] = arquivos_codigo(base)
    relatorio["docker"] = executar(["docker", "--version"])
    relatorio["compose"] = executar(["docker", "compose", "version", "--short"])
    # Somente metadados de ocupação, sem abrir arquivos de clientes ou configuração.
    relatorio["ocupacaoDocker"] = executar(["docker", "system", "df", "-v"])
    relatorio["ocupacaoInstalacao"] = executar(["du", "-x", "-B1", "--max-depth=1", str(base)])
    ids = executar(["docker", "ps", "-aq", "--filter", "label=com.docker.compose.project=" + projeto])
    containers = []
    if ids and ids.split():
        raw = executar(["docker", "inspect", *ids.split()])
        if raw:
            containers = json.loads(raw)
    if not containers:
        relatorio["bloqueios"].append("Nenhum container do projeto consultado. Confirmar projeto/caminho/permissões.")
    relatorio["servicos"] = [resumir_container(c) for c in containers]
    imagens = []
    for c in containers:
        servico = (c.get("Config", {}).get("Labels") or {}).get("com.docker.compose.service")
        if servico not in {"app", "backup"}:
            continue
        por_id = executar(["docker", "image", "inspect", c["Image"]])
        por_tag = executar(["docker", "image", "inspect", c["Config"]["Image"]])
        imagens.append({"servico": servico, "idContainer": c["Image"], "tagContainer": c["Config"]["Image"],
                        "porId": [{k: i.get(k) for k in ("Id", "RepoTags", "RepoDigests", "Size")} for i in json.loads(por_id)] if por_id else None,
                        "porTag": [{k: i.get(k) for k in ("Id", "RepoTags", "RepoDigests", "Size")} for i in json.loads(por_tag)] if por_tag else None})
    relatorio["imagensPreservacao"] = imagens
    app = next((c for c in containers if (c.get("Config", {}).get("Labels") or {}).get("com.docker.compose.service") == "app" and c.get("State", {}).get("Running")), None)
    if app:
        soma = executar(["docker", "exec", app["Id"], "sha256sum", "/app/prisma/schema.prisma"])
        relatorio["schemaImagemSha256"] = soma.split()[0] if soma and re.fullmatch(r"[a-f0-9]{64}", soma.split()[0]) else None
    banco = next((c for c in containers if (c.get("Config", {}).get("Labels") or {}).get("com.docker.compose.service") == "db" and c.get("State", {}).get("Running")), None)
    relatorio["migracoes"] = None
    if banco:
        sql = "SELECT coalesce(json_agg(json_build_object('nome',migration_name,'checksum',checksum,'aplicada',finished_at IS NOT NULL,'revertida',rolled_back_at IS NOT NULL) ORDER BY started_at),'[]'::json) FROM _prisma_migrations"
        raw = executar(["docker", "exec", banco["Id"], "psql", "-X", "-U", "barberos", "-d", "barberos", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql])
        if raw:
            relatorio["migracoes"] = json.loads(raw)
        tamanho = executar(["docker", "exec", banco["Id"], "psql", "-X", "-U", "barberos", "-d", "barberos", "-At", "-c", "SELECT pg_database_size(current_database())"])
        relatorio["bancoBytes"] = int(tamanho.strip()) if tamanho and tamanho.strip().isdigit() else None
    if relatorio["migracoes"] is None:
        relatorio["bloqueios"].append("Migrações não consultadas; não assumir banco vazio.")
    backups = []
    try:
        for p in (base / "backups").glob("barberos-*.sql.gz"):
            if p.is_file() and not p.is_symlink():
                st = p.stat()
                backups.append({"arquivo": p.name, "bytes": st.st_size, "modificadoUnix": int(st.st_mtime)})
    except OSError:
        relatorio["bloqueios"].append("Metadados de backup indisponíveis.")
    relatorio["backupsRecentes"] = sorted(backups, key=lambda b: b["modificadoUnix"], reverse=True)[:3]
    relatorio["backupRestauravelComprovado"] = False
    return relatorio


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-dir", default="/opt/barberos")
    parser.add_argument("--project", default="barberos")
    args = parser.parse_args()
    if not re.fullmatch(r"/[A-Za-z0-9_./-]+", args.base_dir) or ".." in Path(args.base_dir).parts or not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", args.project):
        raise SystemExit("Caminho ou projeto inválido.")
    try:
        print(json.dumps(inspecionar(Path(args.base_dir), args.project)))
    except Exception:
        raise SystemExit("Inspeção incompleta; erro interno omitido para não expor configuração privada.")
