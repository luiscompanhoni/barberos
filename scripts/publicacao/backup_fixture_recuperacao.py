"""Sondas reais na rede descartável do teste Docker; nunca recebe destino de produção."""
import re


def sql_fixture_recuperacao():
    return """
CREATE TYPE public."ArredondamentoPote" AS ENUM ('LEGADO','MAIORES_RESTOS_V1');
CREATE TABLE public.pote_config(id text PRIMARY KEY, arredondamento public."ArredondamentoPote" DEFAULT 'LEGADO');
CREATE TABLE public.prova_backup_ci(id bigserial PRIMARY KEY, valor_centavos int NOT NULL CHECK (valor_centavos>=0));
INSERT INTO public.prova_backup_ci(valor_centavos) VALUES (1000),(2301);
CREATE TABLE public.auditoria(id text PRIMARY KEY, acao text NOT NULL, entidade text NOT NULL, "entidadeId" text NOT NULL);
INSERT INTO public.auditoria VALUES ('__backup_fixture__','prova','backup','fixture');
CREATE FUNCTION public.proteger_auditoria_fixture() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'A auditoria não pode ser alterada nem apagada.'; END; $$;
CREATE TRIGGER auditoria_imutavel BEFORE UPDATE OR DELETE ON public.auditoria FOR EACH ROW EXECUTE FUNCTION public.proteger_auditoria_fixture();
CREATE TRIGGER auditoria_sem_truncate BEFORE TRUNCATE ON public.auditoria FOR EACH STATEMENT EXECUTE FUNCTION public.proteger_auditoria_fixture();
"""


def exigir_fixture(psql, image):
    if not re.fullmatch(r"barberos-backup-validacao:[a-zA-Z0-9_.-]+", image):
        raise ValueError("A sonda exige imagem sintética identificada.")
    if "-d" not in psql or psql[psql.index("-d") + 1] != "fixture" or not any(re.fullmatch(r"backup-db-[a-zA-Z0-9-]+", x) for x in psql):
        raise ValueError("A sonda exige PostgreSQL Docker da fixture.")


def provar_restauro(run, common, image, psql, arquivo):
    exigir_fixture(psql, image)
    if not re.fullmatch(r"barberos-[0-9-]+\.sql\.gz", arquivo):
        raise ValueError("Arquivo fora do padrão de backup sintético.")
    restaurado = [*psql]
    restaurado[restaurado.index("-d") + 1] = "barberos_restaurado"
    consulta = [*restaurado, "-At", "-c"]
    conferir = [*common, "--entrypoint", "python3", image, "/usr/local/bin/backup-manifesto.py", "verificar", "barberos_restaurado", "/backups/" + arquivo, "/backups/" + arquivo.removesuffix(".sql.gz") + ".manifesto.json"]
    run(conferir)
    # A fonte avança depois do dump. A cópia deve manter o estado gravado no dump, não o vivo.
    run([*psql, "-At", "-c", "SELECT pg_catalog.setval('public.prova_backup_ci_id_seq',100,true)"])
    run(conferir)
    assert run([*consulta, "SELECT last_value||'|'||is_called FROM public.prova_backup_ci_id_seq"]).strip() == "2|t"
    negativos = [
        ("valor", "UPDATE public.prova_backup_ci SET valor_centavos=1001 WHERE id=1", "UPDATE public.prova_backup_ci SET valor_centavos=1000 WHERE id=1"),
        ("enum não default", 'ALTER TYPE public."ArredondamentoPote" RENAME VALUE \'MAIORES_RESTOS_V1\' TO \'__PROVA_ALTERADO__\'', 'ALTER TYPE public."ArredondamentoPote" RENAME VALUE \'__PROVA_ALTERADO__\' TO \'MAIORES_RESTOS_V1\''),
        ("sequência", "SELECT pg_catalog.setval('public.prova_backup_ci_id_seq',1,true)", "SELECT pg_catalog.setval('public.prova_backup_ci_id_seq',2,true)"),
        ("trigger", "DROP TRIGGER auditoria_imutavel ON public.auditoria", "CREATE TRIGGER auditoria_imutavel BEFORE UPDATE OR DELETE ON public.auditoria FOR EACH ROW EXECUTE FUNCTION public.proteger_auditoria_fixture()"),
    ]
    for nome, alterar, reverter in negativos:
        run([*consulta, alterar])
        try:
            run(conferir, expect_failure=True)
        finally:
            run([*consulta, reverter])
        run(conferir)
        print("OK: restauro rejeita alteração isolada de " + nome + ".")
    assert run([*consulta, "SELECT nextval('public.prova_backup_ci_id_seq')"]).strip() == "3"
    # Destino novo: não confundir rejeição por mídia omitida com destino já existente.
    run([*psql, "-At", "-c", "DROP DATABASE barberos_restaurado"])
    run([*common, "-e", "BACKUP_ESTUDIO_MEDIA=", image, "restaurar", "/backups/" + arquivo], expect_failure=True)
    assert run([*psql, "-At", "-c", "SELECT count(*) FROM pg_database WHERE datname='barberos_restaurado'"]).strip() == "1"
    print("OK: mídia omitida bloqueia restauração e preserva o banco parcial sintético.")


def provar_snapshot_concorrente(run, common, image, psql):
    exigir_fixture(psql, image)
    # Injeta escrita REAL depois de exportar o snapshot e antes de iniciar pg_dump.
    programa = r'''
import gzip, importlib.util, os, subprocess
assert os.environ.get('PGDATABASE') == 'fixture' and os.environ.get('PGHOST','').startswith('backup-db-')
spec=importlib.util.spec_from_file_location('manifesto_fixture','/usr/local/bin/backup-manifesto.py')
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
c=m.conferencia; original=c.stream; escreveu=False
def stream(args, consumir):
    global escreveu
    if args[0]=='pg_dump' and not escreveu:
        c.psql('fixture','UPDATE public.prova_backup_ci SET valor_centavos=1007 WHERE id=1')
        escreveu=True
    return original(args, consumir)
c.stream=stream
dump='/backups/concorrente-fixture.sql.gz'; manifesto='/backups/concorrente-fixture.manifesto.json'
m.criar('fixture',dump,manifesto)
assert escreveu
subprocess.run(['createdb','barberos_teste_snapshot_ci'],check=True,capture_output=True)
try:
    with gzip.open(dump,'rb') as arquivo:
        subprocess.run(['psql','-Xq','-v','ON_ERROR_STOP=1','-d','barberos_teste_snapshot_ci'],input=arquivo.read(),check=True,capture_output=True)
    m.verificar('barberos_teste_snapshot_ci',dump,manifesto)
    assert c.psql('fixture','SELECT valor_centavos FROM public.prova_backup_ci WHERE id=1').strip()==b'1007'
    assert c.psql('barberos_teste_snapshot_ci','SELECT valor_centavos FROM public.prova_backup_ci WHERE id=1').strip()==b'1000'
finally:
    subprocess.run(['dropdb','barberos_teste_snapshot_ci'],check=True,capture_output=True)
'''
    run([*common, "--entrypoint", "python3", image, "-c", programa])
    print("OK: dump e hashes usam o mesmo snapshot apesar de escritor concorrente real.")
