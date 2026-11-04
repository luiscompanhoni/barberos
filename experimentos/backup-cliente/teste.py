"""Teste descartável em Linux: apenas imagens locais, rede Docker interna e dados fictícios."""
import hashlib
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
import uuid


def run(args, *, stdin=None, expect_failure=False):
    p = subprocess.run(args, input=stdin, text=True, capture_output=True, timeout=180)
    if (p.returncode != 0) != expect_failure:
        raise RuntimeError("Resultado inesperado no ensaio isolado: " + p.stderr[-1000:])
    return p.stdout


def main(image):
    if not re.fullmatch(r"barberos-backup-experimento:[a-zA-Z0-9_.-]+", image):
        raise ValueError("Somente imagem local identificada como experimento é permitida.")
    suffix = uuid.uuid4().hex[:12]
    net, db, s3 = "backup-fixture-" + suffix, "backup-db-" + suffix, "backup-s3-" + suffix
    user = f"{os.getuid()}:{os.getgid()}"
    password = "fixture-descartavel-sem-valor"
    env = ["-e", "PGHOST=" + db, "-e", "PGUSER=fixture_user",
           "-e", "PGPASSWORD=" + password, "-e", "PGDATABASE=fixture",
           "-e", "BACKUP_ESTUDIO_MEDIA=/media-estudio"]
    with tempfile.TemporaryDirectory(prefix="backup-cliente-fixture-") as tmp:
        base = Path(tmp)
        media, backups = base / "media", base / "backups"
        media.mkdir()
        backups.mkdir()
        name = "12345678-1234-1234-1234-123456789abc.mp4"
        content = b"midia-ficticia" * 64
        (media / name).write_bytes(content)
        digest = hashlib.sha256(content).hexdigest()
        common = ["docker", "run", "--rm", "--network", net, "--user", user,
                  "--mount", f"type=bind,src={media},dst=/media-estudio,readonly",
                  "--mount", f"type=bind,src={backups},dst=/backups", *env]
        try:
            run(["docker", "network", "create", "--internal", net])
            run(["docker", "run", "-d", "--rm", "--name", db, "--network", net,
                 "--memory", "512m", "--tmpfs", "/var/lib/postgresql/data:rw,size=256m",
                 "-e", "POSTGRES_PASSWORD=" + password, "-e", "POSTGRES_DB=fixture",
                 "postgres:16-alpine"])
            # Servidor experimental S3 do próprio rclone em tmpfs e rede interna.
            run(["docker", "run", "-d", "--rm", "--name", s3, "--network", net,
                 "--memory", "128m", "--tmpfs", "/dados:rw,size=64m", "--entrypoint", "rclone", image,
                 "serve", "s3", "/dados", "--addr", ":9000", "--auth-key",
                 "fixtureaccess,fixturesecretpassword"])
            for _ in range(60):
                p = subprocess.run(["docker", "exec", db, "pg_isready", "-U", "postgres",
                                    "-d", "fixture"], capture_output=True)
                if p.returncode == 0:
                    break
                time.sleep(1)
            else:
                raise RuntimeError("PostgreSQL sintético não iniciou.")
            run(["docker", "exec", "-i", db, "psql", "-X", "-U", "postgres", "-d", "fixture",
                 "-v", "ON_ERROR_STOP=1"], stdin=f"""
CREATE ROLE fixture_user LOGIN CREATEDB PASSWORD '{password}';
ALTER DATABASE fixture OWNER TO fixture_user;
GRANT ALL ON SCHEMA public TO fixture_user;
""")
            sql = f"""
SET ROLE fixture_user;
CREATE TABLE clientes(id int); INSERT INTO clientes VALUES (1);
CREATE TABLE agendamentos(id int); INSERT INTO agendamentos VALUES (1);
CREATE TABLE _prisma_migrations(migration_name text, finished_at timestamptz);
INSERT INTO _prisma_migrations VALUES ('fixture', now());
CREATE TABLE estudio_clipes(arquivo text, bytes int);
CREATE TABLE estudio_versoes(arquivo text, bytes int, sha256 text);
INSERT INTO estudio_versoes VALUES ('{name}', {len(content)}, '{digest}');
CREATE TABLE backups(id text, tipo text, arquivo text, bytes bigint, restaurado bool,
 conferencia text, "foraDoServidor" bool, erro text);
"""
            psql = ["docker", "exec", "-i", db, "psql", "-X", "-U", "postgres", "-d", "fixture",
                    "-v", "ON_ERROR_STOP=1"]
            run(psql, stdin=sql)
            run([*common, image, "agora"])
            dump = next(backups.glob("barberos-*.sql.gz"))
            paired = backups / (dump.name.removesuffix(".sql.gz") + ".studio.tar.gz")
            assert paired.is_file()
            run([*common, image, "verificar", "/backups/" + dump.name])
            run([*common, image, "restaurar", "/backups/" + dump.name])
            restored = backups / (dump.name.removesuffix(".sql.gz") + "-midias-restauradas")
            assert (restored / name).read_bytes() == content
            run([*common, image, "restaurar", "/backups/" + dump.name], expect_failure=True)
            assert (restored / name).read_bytes() == content
            print("OK: dump, conferência, mídia e restauração; destino existente preservado.")

            # Usa valores fictícios e sistema de arquivos local; não acessa S3 nem serviços externos.
            crypt = '''
set -eu
printf 'fixture-criptografia' > /tmp/original
export BACKUP_SENHA=senha-ficticia
openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_SENHA -in /tmp/original -out /tmp/cifrado
rclone copyto /tmp/cifrado /tmp/copia
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_SENHA -in /tmp/copia -out /tmp/restaurado
cmp /tmp/original /tmp/restaurado
'''
            run([*common, "--entrypoint", "sh", image, "-c", crypt])
            # Checa horário e versão sem depender de rede pública.
            checks = r'''
set -eu
pg_dump --version | grep -E '^pg_dump \(PostgreSQL\) 16\.'
psql --version | grep -E '^psql \(PostgreSQL\) 16\.'
TZ=America/Sao_Paulo date '+%z' | grep -- '^-0300$'
test -s /etc/ssl/certs/ca-certificates.crt
for cmd in pg_dump psql createdb dropdb pg_isready gzip gunzip find stat flock python3 rclone openssl; do command -v "$cmd" >/dev/null; done
'''
            run([*common, "--entrypoint", "sh", image, "-c", checks])
            print("OK: clientes 16, fuso, certificados, criptografia e rclone local.")

            # Exercita os dois uploads S3 e confere o conteúdo após descriptografia.
            s3_env = ["-e", "BACKUP_S3_BUCKET=fixture", "-e", "BACKUP_SENHA=senha-ficticia",
                      "-e", "BACKUP_S3_CHAVE=fixtureaccess", "-e", "BACKUP_S3_SEGREDO=fixturesecretpassword",
                      "-e", "BACKUP_S3_PROVEDOR=Rclone", "-e", "BACKUP_S3_ENDPOINT=http://" + s3 + ":9000"]
            config = ["-e", "RCLONE_CONFIG_FIX_TYPE=s3", "-e", "RCLONE_CONFIG_FIX_PROVIDER=Rclone",
                      "-e", "RCLONE_CONFIG_FIX_ACCESS_KEY_ID=fixtureaccess",
                      "-e", "RCLONE_CONFIG_FIX_SECRET_ACCESS_KEY=fixturesecretpassword",
                      "-e", "RCLONE_CONFIG_FIX_ENDPOINT=http://" + s3 + ":9000"]
            for _ in range(30):
                p = subprocess.run([*common, *config, "--entrypoint", "rclone", image,
                                    "mkdir", "fix:fixture"], capture_output=True)
                if p.returncode == 0:
                    break
                time.sleep(1)
            else:
                raise RuntimeError("S3 sintético indisponível.")
            before = set(backups.glob("barberos-*.sql.gz"))
            run([*common, *s3_env, image, "agora"])
            novos = set(backups.glob("barberos-*.sql.gz")) - before
            assert len(novos) == 1
            s3_dump = next(iter(novos))
            s3_media = backups / (s3_dump.name.removesuffix(".sql.gz") + ".studio.tar.gz")
            for item in (s3_dump, s3_media):
                remote = "fix:fixture/barberos/" + item.name + ".enc"
                dest = "/backups/" + item.name + ".baixado.enc"
                run([*common, *config, "--entrypoint", "rclone", image, "copyto", remote, dest])
                decrypted = "/backups/" + item.name + ".decifrado"
                run([*common, "-e", "BACKUP_SENHA=senha-ficticia", "--entrypoint", "openssl", image,
                     "enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "200000", "-pass",
                     "env:BACKUP_SENHA", "-in", dest, "-out", decrypted])
                assert (backups / (item.name + ".decifrado")).read_bytes() == item.read_bytes()
            print("OK: cópias S3 fictícias do banco e mídia decifradas sem alteração.")

            # Falha da cópia externa fica registrada e não pode remover backup anterior.
            old = backups / "barberos-20000101-0300.sql.gz"
            old.write_bytes(dump.read_bytes())
            os.utime(old, (1, 1))
            s3_env = ["-e", "BACKUP_S3_BUCKET=fixture", "-e", "BACKUP_SENHA=fixture",
                      "-e", "BACKUP_S3_CHAVE=incorreta", "-e", "BACKUP_S3_SEGREDO=incorreto",
                      "-e", "BACKUP_S3_PROVEDOR=Rclone", "-e", "BACKUP_S3_ENDPOINT=http://" + s3 + ":9000",
                      "-e", "RCLONE_RETRIES_SLEEP=1s", "-e", "RCLONE_TIMEOUT=5s",
                      "-e", "RCLONE_CONNECT_TIMEOUT=2s", "-e", "RCLONE_LOW_LEVEL_RETRIES=1"]
            run([*common, *s3_env, image, "agora"], expect_failure=True)
            assert old.is_file() and dump.is_file()
            failure = run(["docker", "exec", db, "psql", "-X", "-U", "postgres", "-d", "fixture",
                           "-At", "-c", "SELECT count(*) FROM backups WHERE restaurado AND NOT \"foraDoServidor\" AND erro IS NOT NULL"])
            assert int(failure.strip()) >= 1
            print("OK: falha de cópia externa é registrada e preserva backups anteriores.")

            # Falha da mídia não pode limpar um backup anterior.
            (media / name).unlink()
            run([*common, image, "agora"], expect_failure=True)
            assert old.is_file() and dump.is_file()
            print("OK: mídia ausente causa falha e preserva backups anteriores.")
        finally:
            subprocess.run(["docker", "rm", "-fv", db], capture_output=True)
            subprocess.run(["docker", "rm", "-fv", s3], capture_output=True)
            subprocess.run(["docker", "network", "rm", net], capture_output=True)


if __name__ == "__main__":
    main(sys.argv[1])
