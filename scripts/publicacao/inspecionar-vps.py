"""Inventário somente de leitura. Não imprime env, logs de aplicações ou dados de clientes."""
import argparse
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
        "montagens": [{"tipo": m.get("Type"), "origem": m.get("Name") if m.get("Type") == "volume" else m.get("Source"), "destino": m.get("Destination")} for m in c.get("Mounts", [])],
    }


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
    relatorio["docker"] = executar(["docker", "--version"])
    relatorio["compose"] = executar(["docker", "compose", "version", "--short"])
    ids = executar(["docker", "ps", "-aq", "--filter", "label=com.docker.compose.project=" + projeto])
    containers = []
    if ids and ids.split():
        raw = executar(["docker", "inspect", *ids.split()])
        if raw:
            containers = json.loads(raw)
    if not containers:
        relatorio["bloqueios"].append("Nenhum container do projeto consultado. Confirmar projeto/caminho/permissões.")
    relatorio["servicos"] = [resumir_container(c) for c in containers]
    banco = next((c for c in containers if (c.get("Config", {}).get("Labels") or {}).get("com.docker.compose.service") == "db" and c.get("State", {}).get("Running")), None)
    relatorio["migracoes"] = None
    if banco:
        sql = "SELECT coalesce(json_agg(json_build_object('nome',migration_name,'checksum',checksum,'aplicada',finished_at IS NOT NULL,'revertida',rolled_back_at IS NOT NULL) ORDER BY started_at),'[]'::json) FROM _prisma_migrations"
        raw = executar(["docker", "exec", banco["Id"], "psql", "-X", "-U", "barberos", "-d", "barberos", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql])
        if raw:
            relatorio["migracoes"] = json.loads(raw)
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
