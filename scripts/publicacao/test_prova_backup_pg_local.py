import importlib.util
import os
from pathlib import Path
import json
import subprocess
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("prova_pg_local", Path(__file__).with_name("provar_backup_pg_local.py"))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class ProvaPgLocalTest(unittest.TestCase):
    def test_sql_nao_aceita_alvo_fora_dos_dois_bancos_e_catalogo(self):
        with patch.object(m, "executar") as executar, self.assertRaises(RuntimeError):
            m.sql("barberos_producao", "SELECT 1")
        executar.assert_not_called()

    def test_sql_com_acentos_vai_como_utf8_no_stdin_sem_sql_no_argv(self):
        texto = "SELECT 'Fictício e proteção';"
        with patch.object(m, "executar", return_value=b"") as executar:
            m.sql(m.FONTE, texto)
        self.assertEqual(executar.call_args.args[1][-2:], ["-f", "-"])
        self.assertNotIn("-c", executar.call_args.args[1])
        self.assertNotIn(texto, executar.call_args.args[1])
        self.assertEqual(executar.call_args.kwargs["input"], texto.encode("utf-8"))

    def test_conexao_usa_host_porta_usuario_fixos_sem_uri_herdada(self):
        with patch.dict(os.environ, {"DATABASE_URL": "postgresql://nao-usar/nao-usar", "PGSERVICE": "nao-usar", "PGOPTIONS": "nao-usar"}), \
             patch.object(Path, "is_file", return_value=True), patch.object(m.shutil, "which", return_value=str(m.PG / "psql.exe")), \
             patch.object(m, "sql", return_value=b"auditoria_teste|127.0.0.1|55439\n") as sql:
            m.ambiente()
            self.assertEqual((os.environ["PGHOST"], os.environ["PGPORT"], os.environ["PGUSER"]), ("127.0.0.1", "55439", "auditoria_teste"))
            for chave in ("DATABASE_URL", "PGSERVICE", "PGOPTIONS"):
                self.assertNotIn(chave, os.environ)
            self.assertIn("host(inet_server_addr())", sql.call_args.args[1])

    def test_identidade_divergente_impede_fixtures(self):
        with patch.dict(os.environ), patch.object(Path, "is_file", return_value=True), \
             patch.object(m.shutil, "which", return_value=str(m.PG / "psql.exe")), \
             patch.object(m, "sql", return_value=b"outro|127.0.0.1|54128\n"), self.assertRaises(RuntimeError):
            m.ambiente()

    def test_banco_preexistente_fica_preservado(self):
        with patch.object(m, "sql", return_value=m.FONTE.encode()), self.assertRaises(RuntimeError):
            m.conferir_destino_vazio()

    def test_limpeza_recusa_nome_ou_marcador_que_nao_pertencem_a_execucao(self):
        with patch.object(m, "sql") as sql, self.assertRaises(RuntimeError):
            m.limpar_criados(["barberos"], m.MARCADOR + "fixture")
        sql.assert_not_called()
        with patch.object(m, "sql", return_value=b"auditoria_teste|outro-marcador") as sql, self.assertRaises(RuntimeError):
            m.limpar_criados([m.RESTAURADO], m.MARCADOR + "fixture")
        self.assertEqual(sql.call_count, 1)

    def test_limpeza_confere_propriedade_e_nao_usa_force(self):
        marcador = m.MARCADOR + "fixture"
        with patch.object(m, "sql", side_effect=[("auditoria_teste|" + marcador).encode(), b""]) as sql:
            m.limpar_criados([m.RESTAURADO], marcador)
        self.assertIn("shobj_description", sql.call_args_list[0].args[1])
        self.assertEqual(sql.call_args.args[1], 'DROP DATABASE "' + m.RESTAURADO + '"')

    def test_saida_fora_das_evidencias_para_antes_de_conectar(self):
        args = ["prova", "--executar-fixtures-locais", "--saida", str(m.REPO / "fora-das-evidencias")]
        with patch("sys.argv", args), patch.object(m, "ambiente") as ambiente, self.assertRaises(RuntimeError):
            m.main()
        ambiente.assert_not_called()

    def test_diagnostico_nao_expoe_erro_sql_ou_comando_desconhecido(self):
        for erro in (RuntimeError("SELECT dado_privado; senha-injetada"), subprocess.TimeoutExpired("comando_privado", 5)):
            d = json.dumps(m.diagnostico_seguro(erro))
            self.assertNotIn("dado_privado", d)
            self.assertNotIn("senha-injetada", d)
            self.assertNotIn("comando_privado", d)
        retorno = SimpleNamespace(returncode=1, stderr=b"ERROR: 42501: SELECT segredo_fixture", stdout=b"")
        with patch.object(m.subprocess, "run", return_value=retorno):
            with self.assertRaises(m.FalhaProva) as erro:
                m.executar("psql", [])
        d = m.diagnostico_seguro(erro.exception)
        self.assertEqual(d["controle"]["sqlstate"], "42501")
        self.assertNotIn("segredo_fixture", json.dumps(d))


if __name__ == "__main__":
    unittest.main()
