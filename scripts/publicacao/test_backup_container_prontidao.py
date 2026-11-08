import importlib.util
from pathlib import Path
import subprocess
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "backup_container", Path(__file__).with_name("teste-backup-container.py"))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class ProntidaoPostgresTest(unittest.TestCase):
    def setUp(self):
        self.psql = m.psql_fixture("backup-db-ficticio", "senha-ficticia")

    def test_servidor_temporario_por_socket_nao_libera_fixtures(self):
        tentativas = []

        def servidor(args, **kwargs):
            tentativas.append(args)
            # Durante initdb o socket já responde, mas a porta TCP ainda não.
            tcp = "-h" in args and args[args.index("-h") + 1] == "127.0.0.1"
            if len(tentativas) == 1 and tcp:
                return SimpleNamespace(returncode=2, stdout="")
            return SimpleNamespace(returncode=0, stdout="1\n")

        with patch.object(m.subprocess, "run", side_effect=servidor), \
             patch.object(m.time, "sleep") as sleep:
            m.aguardar_postgres_tcp(self.psql)
        self.assertEqual(len(tentativas), 2)
        sleep.assert_called_once()
        for args in tentativas:
            self.assertEqual(args[-3:], ["-At", "-c", "SELECT 1"])
            self.assertIn("PGPASSWORD=senha-ficticia", args)
            self.assertIn("-w", args)

    def test_resposta_de_consulta_precisa_confirmar_sucesso(self):
        respostas = [SimpleNamespace(returncode=0, stdout=""),
                     SimpleNamespace(returncode=0, stdout="1\n")]
        with patch.object(m.subprocess, "run", side_effect=respostas) as run, \
             patch.object(m.time, "sleep"):
            m.aguardar_postgres_tcp(self.psql)
        self.assertEqual(run.call_count, 2)

    def test_timeout_transitorio_nao_libera_prontidao(self):
        respostas = [subprocess.TimeoutExpired("psql", 3),
                     SimpleNamespace(returncode=0, stdout="1\n")]
        with patch.object(m.subprocess, "run", side_effect=respostas) as run, \
             patch.object(m.time, "sleep"):
            m.aguardar_postgres_tcp(self.psql)
        self.assertEqual(run.call_count, 2)

    def test_prazo_esgotado_impede_ddl_e_nao_expoe_senha(self):
        with patch.object(m.time, "monotonic", side_effect=[0, 0, 61, 61]), \
             patch.object(m.subprocess, "run", return_value=SimpleNamespace(returncode=2, stdout="")) as run, \
             self.assertRaisesRegex(RuntimeError, "SQL autenticado por TCP") as erro:
            m.aguardar_postgres_tcp(self.psql)
        self.assertEqual(run.call_count, 1)
        self.assertEqual(run.call_args.args[0][-1], "SELECT 1")
        self.assertLessEqual(run.call_args.kwargs["timeout"], 3)
        self.assertNotIn("senha-ficticia", str(erro.exception))

    def test_sondas_de_recuperacao_recusam_banco_ou_imagem_fora_da_fixture(self):
        with self.assertRaisesRegex(ValueError, "imagem sintética"):
            m.provar_restauro(None, [], "barberos-backup:producao", self.psql, "barberos-2026-01.sql.gz")
        nao_fixture = [*self.psql]
        nao_fixture[nao_fixture.index("-d") + 1] = "barberos"
        with self.assertRaisesRegex(ValueError, "PostgreSQL Docker"):
            m.provar_snapshot_concorrente(None, [], "barberos-backup-validacao:fixture", nao_fixture)


if __name__ == "__main__":
    unittest.main()
