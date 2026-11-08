"""Isolamento da instalação durante publicação. Nunca restaura dados automaticamente."""
import json
import os
from pathlib import Path

from deploy_vps_comum import CONTROLES_PUBLICACAO, consultar_banco, executar

MARCADOR = "recuperacao-pendente.json"


def exigir_sem_recuperacao(base):
    if (base / MARCADOR).exists() or (base / MARCADOR).is_symlink():
        raise RuntimeError("Recuperação pendente. Validar e liberar conforme docs/recuperacao-segura.md.")


def registrar_quarentena(base, estado):
    destino, temporario = base / MARCADOR, base / (MARCADOR + ".tmp")
    if destino.is_symlink() or temporario.is_symlink():
        raise RuntimeError("Marcador de recuperação inesperado.")
    with open(temporario, "w", encoding="utf8", opener=lambda p, f: os.open(p, f, 0o600)) as f:
        json.dump({"formato": 1, **estado, "restaurarBancoAutomaticamente": False}, f, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.chmod(temporario, 0o600)
    os.replace(temporario, destino)


def containers_projeto(projeto):
    ids = executar(["docker", "ps", "-aq", "--filter", "label=com.docker.compose.project=" + projeto]).decode().split()
    if not ids:
        raise RuntimeError("Nenhum container da instalação foi identificado.")
    return json.loads(executar(["docker", "inspect", *ids]))


def exigir_banco_isolavel(projeto, banco):
    rede = projeto + "_default"
    if set(banco["NetworkSettings"]["Networks"]) != {rede}:
        raise RuntimeError("Banco em rede não prevista; definir isolamento manual antes de publicar.")
    if any(binds for binds in banco["NetworkSettings"].get("Ports", {}).values()):
        raise RuntimeError("Banco possui porta publicada; isolamento automático recusado.")
    membros = json.loads(executar(["docker", "network", "inspect", rede]))[0].get("Containers", {})
    if membros:
        inspecoes = json.loads(executar(["docker", "inspect", *membros]))
        if any(c["Config"].get("Labels", {}).get("com.docker.compose.project") != projeto for c in inspecoes):
            raise RuntimeError("Outro projeto acessa a rede do banco; isolamento automático recusado.")


def parar_escritores(projeto, banco_id):
    servicos = containers_projeto(projeto)
    bancos = [c for c in servicos if c["Config"].get("Labels", {}).get("com.docker.compose.service") == "db"]
    if len(bancos) != 1 or bancos[0]["Id"] != banco_id:
        raise RuntimeError("Identidade do banco mudou durante o isolamento.")
    ativos = [c for c in servicos if c["Id"] != banco_id and c["State"].get("Running")]
    if ativos:
        executar(["docker", "stop", "--time", "45", *[c["Id"] for c in ativos]], prazo=180)
    restantes = containers_projeto(projeto)
    if any(c["Id"] != banco_id and c["State"].get("Running") for c in restantes):
        raise RuntimeError("Escritor ou ingresso ainda ativo; recuperação deve permanecer fechada.")
    conexoes = consultar_banco(banco_id, "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() "
                              "AND pid<>pg_backend_pid() AND backend_type='client backend'")
    if conexoes != "0":
        raise RuntimeError("Outra conexão ao banco permanece ativa; não será encerrada automaticamente.")
    return [{"id": c["Id"], "servico": c["Config"].get("Labels", {}).get("com.docker.compose.service")} for c in ativos]


def retomar_auxiliares(anteriores, servicos):
    for c in anteriores:
        if c["servico"] in servicos:
            executar(["docker", "start", c["id"]])


def ambiente_rollback():
    # Nem o .env nem um override antigo podem religar efeitos externos durante o retorno.
    return {**CONTROLES_PUBLICACAO, "BARBEROS_QUARENTENA_RESTAURACAO": "false"}


def calcular_reservas(banco_bytes, midias_bytes):
    if any(not isinstance(n, int) or n < 0 for n in (banco_bytes, midias_bytes)):
        raise RuntimeError("Medição de capacidade inválida.")
    gib = 1024**3
    # Dump sem assumir compressão + tar + diretório de verificação + clone/índices/WAL.
    return {"backups": 4 * banco_bytes + 3 * midias_bytes + 2 * gib,
            "postgres": 3 * banco_bytes + gib, "margem": gib}


def conferir_capacidade(base, banco, app, volume):
    import shutil
    if not any(m.get("Type") == "volume" and m.get("Name") == volume and m.get("Destination") == "/app/media" for m in app.get("Mounts", [])):
        raise RuntimeError("Volume de mídia da instalação atual não confirmado.")
    tamanho_banco = int(consultar_banco(banco["Id"], "SELECT pg_database_size(current_database())"))
    presentes = consultar_banco(banco["Id"], "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' "
                                "AND table_name IN ('estudio_clipes','estudio_versoes')")
    if presentes not in {"0", "2"}:
        raise RuntimeError("Schema de mídias incompleto na medição.")
    tamanho_midias = int(consultar_banco(banco["Id"], "SELECT coalesce(sum(bytes),0) FROM (SELECT bytes FROM estudio_clipes "
                        "WHERE arquivo IS NOT NULL UNION ALL SELECT bytes FROM estudio_versoes WHERE arquivo IS NOT NULL) r")) if presentes == "2" else 0
    refs = calcular_reservas(tamanho_banco, tamanho_midias)
    montagens = {m["Destination"]: m for m in banco.get("Mounts", [])}
    dados = montagens.get("/var/lib/postgresql/data", {}).get("Source")
    volume_banco = montagens.get("/var/lib/postgresql/data", {}).get("Name")
    if not dados or not volume_banco or not Path(dados).is_dir():
        raise RuntimeError("Filesystem do PostgreSQL não identificado.")
    midia = json.loads(executar(["docker", "volume", "inspect", volume]))[0].get("Mountpoint")
    if not midia or not Path(midia).is_dir():
        raise RuntimeError("Filesystem de mídia não identificado; não criar outro volume automaticamente.")
    backups = base / "backups"
    locais = [(base, refs["margem"]), (backups, refs["backups"]), (Path(dados), refs["postgres"]), (Path(midia), refs["margem"])]
    por_dispositivo = {}
    for caminho, necessario in locais:
        st = caminho.stat()
        recurso = por_dispositivo.setdefault(st.st_dev, {"livre": shutil.disk_usage(caminho).free, "necessario": 0})
        recurso["necessario"] += necessario
    if any(r["livre"] < r["necessario"] for r in por_dispositivo.values()):
        raise RuntimeError("Reserva insuficiente para banco, clone, WAL, dump e restauração das mídias.")
    return {"bancoBytes": tamanho_banco, "midiasBytes": tamanho_midias,
            "volumePostgres": volume_banco, "filesystems": list(por_dispositivo.values()), "estimativaConservadora": True}
