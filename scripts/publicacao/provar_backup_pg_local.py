"""Prova real do comparador SQL, exclusivamente em fixtures PostgreSQL locais; sem Docker/deploy."""
import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import uuid

REPO = Path(__file__).resolve().parents[2]
PG = Path("C:/Program Files/PostgreSQL/16/bin")
FONTE = "barberos_ci_local_backup_estabilizacao"
RESTAURADO = FONTE + "_restaurado"
BASE = ["-h", "127.0.0.1", "-p", "55439", "-U", "auditoria_teste", "-w"]
MARCADOR = "barberos_prova_backup_local:"
ETAPA = "inicializacao"


class FalhaProva(RuntimeError):
    """Somente causas próprias estáticas entram no relatório, nunca stderr/SQL recebido."""
    def __init__(self, codigo, causa, **controle):
        super().__init__(causa)
        self.codigo, self.controle = codigo, controle


def etapa(nome):
    global ETAPA
    ETAPA = nome
    print(json.dumps({"etapa": nome}), flush=True)


def diagnostico_seguro(erro):
    d = {"etapa": ETAPA, "tipo": type(erro).__name__, "codigo": "FALHA_NAO_CLASSIFICADA",
         "causa": "A etapa não concluiu; conteúdo de comandos, dados e credenciais foi omitido."}
    if isinstance(erro, FalhaProva):
        d.update(codigo=erro.codigo, causa=str(erro), controle=erro.controle)
    elif type(erro) is RuntimeError:
        conhecidas = {
            "Linhas ou hash de tabela divergentes do snapshot do dump.": "HASH_TABELA_DIVERGENTE",
            "Estrutura, privilégios ou proteção do banco divergentes.": "ESTRUTURA_DIVERGENTE",
            "Restrição restaurada não equivale à referência.": "CONSTRAINT_DIVERGENTE",
            "Fluxo privado do backup não concluiu.": "STREAM_CONFERENCIA_FALHOU",
        }
        if str(erro) in conhecidas:
            d.update(codigo=conhecidas[str(erro)], causa=str(erro))
    elif isinstance(erro, subprocess.TimeoutExpired):
        d.update(codigo="TIMEOUT_LOCAL", causa="Um processo PostgreSQL local ultrapassou o tempo permitido.")
    return d


def executar(programa, args, **opcoes):
    r = subprocess.run([str(PG / (programa + ".exe")), *args], capture_output=True, timeout=180,
                       **opcoes)
    if r.returncode:
        # VERBOSITY=sqlstate, nas chamadas psql, permite diagnóstico sem expor erro SQL ou valores.
        estados = re.findall(rb"(?:ERROR|FATAL|ERRO):\s*([0-9A-Z]{5})\b", r.stderr or b"")
        raise FalhaProva("PROCESSO_POSTGRES_FALHOU", "Um comando PostgreSQL local não concluiu.",
                         programa=programa, codigoSaida=r.returncode,
                         sqlstate=estados[-1].decode("ascii") if estados else None)
    return r.stdout


def sql(banco, texto):
    if banco not in {"postgres", FONTE, RESTAURADO}:
        raise FalhaProva("ALVO_NAO_PERMITIDO", "Banco fora da lista fixa da prova local.")
    # No Windows, o argv do psql pode passar pela página de códigos ANSI. SQL vai em bytes UTF-8,
    # inclusive mensagens de trigger e fixtures com acentos; nenhum comando fica na linha do processo.
    return executar("psql", [*BASE, "-d", banco, "-XAtq", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=sqlstate", "-f", "-"],
                    input=texto.encode("utf-8"))


def ambiente():
    etapa("ambiente.binarios")
    if not all((PG / (x + ".exe")).is_file() for x in ("psql", "pg_dump", "pg_restore")):
        raise FalhaProva("BINARIOS_AUSENTES", "Binários PostgreSQL 16 não encontrados no caminho previsto.")
    for chave in ("PGSERVICE", "PGSERVICEFILE", "PGOPTIONS", "PGDATABASE", "DATABASE_URL"):
        os.environ.pop(chave, None)
    os.environ.update(PGHOST="127.0.0.1", PGPORT="55439", PGUSER="auditoria_teste",
                      PGCONNECT_TIMEOUT="5", PGCLIENTENCODING="UTF8", PGTZ="UTC",
                      PGAPPNAME="barberos_prova_backup_local", PATH=str(PG) + os.pathsep + os.environ.get("PATH", ""))
    etapa("ambiente.resolucao_psql")
    if Path(shutil.which("psql") or "").resolve() != (PG / "psql.exe").resolve():
        raise FalhaProva("RESOLUCAO_PSQL_DIVERGENTE", "Resolução do psql divergente do binário local permitido.", pathextPresente=bool(os.environ.get("PATHEXT")))
    etapa("ambiente.identidade_local")
    # host(inet) omite a máscara /32; o cast explícito ::text pode incluí-la.
    identidade = sql("postgres", "SELECT current_user||'|'||host(inet_server_addr())||'|'||inet_server_port()::text").decode().strip()
    if identidade != "auditoria_teste|127.0.0.1|55439":
        raise FalhaProva("IDENTIDADE_DIVERGENTE", "Conexão local não corresponde à identidade autorizada.")


def carregar_comparador():
    spec = importlib.util.spec_from_file_location("comparador_backup_real", REPO / "deploy/backup-conferencia.py")
    c = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(c)
    # O runner SQL mantém host/porta/usuário explícitos; nenhum alvo vem de URI ou do ambiente anterior.
    c.psql = sql
    return c


def conferir_destino_vazio():
    existentes = sql("postgres", "SELECT datname FROM pg_database WHERE datname IN ('" + FONTE + "','" + RESTAURADO + "')").strip()
    if existentes:
        raise FalhaProva("BANCO_PREEXISTENTE", "Um dos bancos exclusivos já existe; preservar e revisar antes de repetir.")


def criar_banco(nome, marcador):
    if nome not in {FONTE, RESTAURADO} or not marcador.startswith(MARCADOR):
        raise FalhaProva("MARCADOR_INVALIDO", "Destino ou marcador inválido.")
    sql("postgres", 'CREATE DATABASE "' + nome + '"')
    sql("postgres", 'COMMENT ON DATABASE "' + nome + '" IS \'' + marcador + "'")


def migrar():
    arquivos = sorted((REPO / "prisma/migrations").glob("*/migration.sql"))
    if not arquivos:
        raise FalhaProva("MIGRACOES_AUSENTES", "Sem migrações na cópia local.")
    for arquivo in arquivos:
        etapa("migracao." + arquivo.parent.name)
        executar("psql", [*BASE, "-d", FONTE, "-Xq", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=sqlstate", "-f", str(arquivo)])
    # Metadados sintéticos explicitamente separados do histórico real do Prisma.
    sql(FONTE, "CREATE TABLE public.prova_migracoes_locais (nome text PRIMARY KEY, sha256 text NOT NULL)")
    for arquivo in arquivos:
        nome = arquivo.parent.name.replace("'", "''")
        with arquivo.open("rb") as conteudo:
            digest = hashlib.file_digest(conteudo, "sha256").hexdigest()
        sql(FONTE, "INSERT INTO public.prova_migracoes_locais VALUES ('" + nome + "','" + digest + "')")
    return len(arquivos)


def fixtures():
    sql(FONTE, """
      CREATE TABLE public.prova_backup_local (
        id bigserial PRIMARY KEY, valor_centavos integer NOT NULL CHECK (valor_centavos >= 0),
        contexto jsonb NOT NULL, notas text NOT NULL
      );
      INSERT INTO public.prova_backup_local(valor_centavos,contexto,notas) VALUES
        (1000,'{"fixture":"valor1","nao_e_chave_real":true}','Fictício com acento e quebra\nlinha'),
        (2301,'{"fixture":"valor2","nao_e_credencial":true}','Segundo dado sintético');
      INSERT INTO public.auditoria(id,acao,entidade,"entidadeId")
        VALUES ('__backup_fixture__','prova_local','backup','fixture');
    """)


def sequencias(banco, c):
    lista = json.loads(sql(banco, "SELECT coalesce(json_agg(json_build_array(schemaname,sequencename) ORDER BY schemaname,sequencename),'[]') FROM pg_sequences WHERE schemaname !~ '^pg_' AND schemaname<>'information_schema'"))
    return {schema + "." + nome: sql(banco, "SELECT last_value||'|'||is_called FROM " + c.ident(schema) + "." + c.ident(nome)).decode().strip() for schema, nome in lista}


def exportar(pasta, c):
    dump = pasta / "snapshot-sintetico.dump"
    etapa("snapshot.exportar")
    with tempfile.TemporaryFile() as erros:
        p = subprocess.Popen([str(PG / "psql.exe"), *BASE, "-d", FONTE, "-XAtq", "-v", "ON_ERROR_STOP=1"],
                             stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=erros, text=True, encoding="utf8")
        try:
            p.stdin.write("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;SELECT pg_export_snapshot();\n")
            p.stdin.flush()
            snapshot = p.stdout.readline().strip()
            if not re.fullmatch(r"[0-9A-Fa-f]{8}-[0-9A-Fa-f]{8}-[0-9]+", snapshot):
                raise FalhaProva("SNAPSHOT_NAO_EXPORTADO", "O PostgreSQL não exportou snapshot consistente.")
            # Escrita REAL após exportação: dump e hashes devem continuar vendo o valor anterior.
            etapa("snapshot.escrita_concorrente_fixture")
            sql(FONTE, "UPDATE public.prova_backup_local SET valor_centavos=1007 WHERE id=1")
            etapa("snapshot.pg_dump")
            executar("pg_dump", [*BASE, "-d", FONTE, "--format=custom", "--snapshot=" + snapshot, "-f", str(dump)])
            etapa("snapshot.hashes_e_schema")
            referencia = c.capturar(FONTE, snapshot)
        finally:
            if p.poll() is None:
                p.stdin.close()
                try:
                    p.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    p.kill(); p.wait(timeout=15)
            p.stdout.close()
    with dump.open("rb") as arquivo:
        digest = hashlib.file_digest(arquivo, "sha256").hexdigest()
    manifesto = {"formato": 1, "snapshotConsistente": True, "dumpSha256": digest, **referencia}
    (pasta / "manifesto-sintetico.json").write_text(json.dumps(manifesto, ensure_ascii=False, sort_keys=True), encoding="utf8")
    return dump, referencia


def exigir_falha(fn, motivo):
    try:
        fn()
    except RuntimeError:
        return True
    raise FalhaProva("NEGATIVO_NAO_REJEITADO", "Um controle negativo não foi rejeitado.", controle=motivo)


def conferir(pasta, dump, referencia, c):
    etapa("restauracao.pg_restore")
    executar("pg_restore", [*BASE, "-d", RESTAURADO, "--exit-on-error", str(dump)])
    etapa("restauracao.comparar_todas_tabelas_schema")
    restaurado = c.capturar(RESTAURADO)
    c.comparar(referencia, restaurado)
    estados_iguais = sequencias(FONTE, c) == sequencias(RESTAURADO, c)
    if not estados_iguais:
        raise FalhaProva("SEQUENCIAS_DIVERGENTES", "Estado de sequências divergente da cópia sintética.")
    vivo = c.capturar(FONTE)
    if vivo["tabelas"]["public.prova_backup_local"] == referencia["tabelas"]["public.prova_backup_local"]:
        raise FalhaProva("ESCRITOR_NAO_EXERCITADO", "A escrita concorrente não foi exercitada.")
    etapa("restauracao.auditoria_tres_eventos")
    sql(RESTAURADO, c.sql_prova_auditoria())
    c.comparar(referencia, c.capturar(RESTAURADO))
    etapa("restauracao.negativo_valor_mesma_contagem")
    sql(RESTAURADO, "UPDATE public.prova_backup_local SET valor_centavos=1001 WHERE id=1")
    valor_detectado = exigir_falha(lambda: c.comparar(referencia, c.capturar(RESTAURADO)), "valor alterado com mesma contagem")
    sql(RESTAURADO, "UPDATE public.prova_backup_local SET valor_centavos=1000 WHERE id=1")
    trigger = next(t["definicao"] for t in referencia["estrutura"]["triggers"] if t["chave"] == "public.auditoria.auditoria_imutavel")
    etapa("restauracao.negativo_trigger_e_auditoria")
    sql(RESTAURADO, "DROP TRIGGER auditoria_imutavel ON public.auditoria")
    trigger_detectado = exigir_falha(lambda: c.comparar(referencia, c.capturar(RESTAURADO)), "trigger ausente")
    auditoria_detectada = exigir_falha(lambda: sql(RESTAURADO, c.sql_prova_auditoria()), "auditoria sem proteção")
    sql(RESTAURADO, trigger)
    c.comparar(referencia, c.capturar(RESTAURADO))
    etapa("restauracao.proximo_id")
    proximo = sql(RESTAURADO, "SELECT nextval(pg_get_serial_sequence('public.prova_backup_local','id'))").strip() == b"3"
    if not proximo:
        raise FalhaProva("PROXIMO_ID_DIVERGENTE", "Próximo ID restaurado divergente.")
    return {"tabelas": len(restaurado["tabelas"]), "todasLinhasEHashesIguais": True,
            "gruposSchemaIguais": sorted(restaurado["estrutura"]), "snapshotComEscritorConcorrente": True,
            "estadosSequenciasIguaisAntesDaSonda": estados_iguais, "proximoIdCorreto": proximo,
            "auditoriaUpdateDeleteTruncateRecusados": True,
            "negativos": {"valorAlteradoMesmaContagem": valor_detectado, "triggerAusente": trigger_detectado, "auditoriaSemTrigger": auditoria_detectada}}


def limpar_criados(criados, marcador):
    for nome in reversed(criados):
        if nome not in {FONTE, RESTAURADO}:
            raise FalhaProva("LIMPEZA_ALVO_NAO_PERMITIDO", "Limpeza fora da lista fixa recusada.")
        controle = sql("postgres", "SELECT pg_get_userbyid(datdba)||'|'||coalesce(shobj_description(oid,'pg_database'),'') FROM pg_database WHERE datname='" + nome + "'").decode().strip()
        if controle != "auditoria_teste|" + marcador:
            raise FalhaProva("LIMPEZA_PROPRIEDADE_DIVERGENTE", "Propriedade/marcador mudou; banco preservado.")
        # DROP sem FORCE recusa conexões inesperadas; somente bancos criados nesta execução.
        sql("postgres", 'DROP DATABASE "' + nome + '"')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--executar-fixtures-locais", action="store_true")
    parser.add_argument("--limpar-ao-terminar", action="store_true")
    parser.add_argument("--saida", type=Path, required=True)
    args = parser.parse_args()
    if not args.executar_fixtures_locais:
        raise FalhaProva("MODO_NAO_INDICADO", "Modo de execução local não indicado.")
    pasta = args.saida.resolve()
    permitido = REPO.parents[1] / "outputs/estabilizacao-2026-11-08"
    if not pasta.is_relative_to(permitido.resolve()) or pasta == permitido.resolve() or pasta.exists():
        raise FalhaProva("SAIDA_NAO_PERMITIDA", "Use uma pasta nova dentro das evidências de estabilização.")
    pasta.mkdir(parents=True)
    os.environ["TEMP"] = os.environ["TMP"] = str(pasta)
    tempfile.tempdir = str(pasta)
    criados, marcador = [], MARCADOR + str(uuid.uuid4())
    resultado = {"somenteSintetico": True, "host": "127.0.0.1", "porta": 55439, "usuario": "auditoria_teste",
                 "dockerExecutado": False, "helperSha256": hashlib.sha256((REPO / "deploy/backup-conferencia.py").read_bytes()).hexdigest(),
                 "criadoEm": datetime.now(timezone.utc).isoformat(), "concluido": False,
                 "marcadorExecucao": marcador, "bancosCriadosNestaExecucao": criados}
    try:
        ambiente(); etapa("preflight.bancos_nao_existentes"); conferir_destino_vazio()
        etapa("carregar_comparador"); c = carregar_comparador()
        for nome in (FONTE, RESTAURADO):
            etapa("criar_banco." + ("fonte" if nome == FONTE else "restaurado"))
            criar_banco(nome, marcador); criados.append(nome)
        resultado["migracoesAplicadasEmFixture"] = migrar()
        etapa("fixtures")
        fixtures(); dump, referencia = exportar(pasta, c)
        resultado.update(conferir(pasta, dump, referencia, c))
        resultado["concluido"] = True
    except Exception as erro:
        resultado["falha"] = "Prova não concluída; bancos/artefatos sintéticos preservados para inspeção. Sem operação em outro cluster."
        resultado["diagnostico"] = diagnostico_seguro(erro)
        raise
    finally:
        falha_limpeza = None
        if args.limpar_ao_terminar and resultado["concluido"]:
            etapa("limpeza_bancos_criados_nesta_execucao")
            try:
                limpar_criados(criados, marcador); resultado["bancosSinteticosRemovidos"] = True
            except Exception as erro:
                resultado.update(concluido=False, diagnostico=diagnostico_seguro(erro), bancosSinteticosRemovidos=False)
                falha_limpeza = erro
        resultado["ultimaEtapa"] = ETAPA
        resultado["limites"] = "Compara SQL real em Windows/PG16 local. Não executa Docker, backup.sh, escrita O_NOFOLLOW, criptografia, mídia ou recuperação de produção. Não altera/reinicia cluster nem toca porta 54128."
        (pasta / "resultado.json").write_text(json.dumps(resultado, ensure_ascii=False, indent=2), encoding="utf8")
        if falha_limpeza:
            raise falha_limpeza
    print(json.dumps({k: resultado[k] for k in ("concluido", "tabelas", "migracoesAplicadasEmFixture", "todasLinhasEHashesIguais", "snapshotComEscritorConcorrente", "auditoriaUpdateDeleteTruncateRecusados")}))


if __name__ == "__main__":
    try:
        main()
    except Exception as erro:
        print(json.dumps({"concluido": False, "diagnostico": diagnostico_seguro(erro)}), flush=True)
        raise SystemExit(1)
