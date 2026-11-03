import importlib.util
import ast
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("inspecao", Path(__file__).with_name("inspecionar-vps.py"))
inspecao = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inspecao)


class InspecaoTest(unittest.TestCase):
    def test_python_incorporado_no_cmd_valido_em_todas_as_variantes(self):
        gerador = Path(__file__).with_name("diagnostico-windows.mjs").resolve().as_uri()
        programa = """
import { gerarDiagnostico } from %s;
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const blob = Buffer.concat([Buffer.from([0,0,0,11]),Buffer.from('ssh-ed25519'),Buffer.from([0,0,0,32]),Buffer.alloc(32)]);
const chave = 'ssh-ed25519 ' + blob.toString('base64');
const pin = 'SHA256:' + createHash('sha256').update(blob).digest('base64').replace(/=+$/, '');
const corpos = [];
for (const [i,args] of [[],[pin],[pin,chave]].entries()) {
  const destino = process.argv[1] + '/' + i + '.cmd';
  const r = gerarDiagnostico(destino, ...args);
  corpos.push(readFileSync(destino,'utf8').split('\\r\\n').slice(r.linhasCabecalho).join('\\n'));
}
process.stdout.write(JSON.stringify(corpos));
""" % json.dumps(gerador)
        with tempfile.TemporaryDirectory() as d:
            corpos = json.loads(subprocess.check_output(["node", "--input-type=module", "-e", programa, d]))
        for corpo in corpos:
            ast.parse(corpo)

    def test_deploy_legado_recusa_producao_antes_de_conectar(self):
        script = Path(__file__).resolve().parents[1] / "deploy.sh"
        r = subprocess.run(["bash", str(script), "alvo-inexistente.invalid"], capture_output=True, timeout=5)
        self.assertEqual(r.returncode, 2)
        self.assertIn("Produção bloqueada", r.stderr.decode())

    def test_seleciona_metadados_sem_env_ou_logs(self):
        c = {"Id": "a" * 64, "Image": "sha256:abc", "Config": {
            "Env": ["SEGREDO=sentinela-privada"],
            "Labels": {"com.docker.compose.service": "app", "etiqueta-privada": "nao-exibir"}},
            "State": {"Status": "running", "Health": {"Status": "healthy", "Log": ["sentinela-privada"]}}}
        r = inspecao.resumir_container(c)
        self.assertEqual(r["servico"], "app")
        self.assertEqual(r["saude"], "healthy")
        self.assertIsNone(r["revisaoDeclarada"])
        self.assertNotIn("sentinela", json.dumps(r))
        self.assertNotIn("nao-exibir", json.dumps(r))

    def test_indisponibilidade_nao_significa_instalacao_vazia_ou_backup_valido(self):
        with tempfile.TemporaryDirectory() as d, patch.object(inspecao, "executar", return_value=None):
            r = inspecao.inspecionar(Path(d), "barberos")
        self.assertIsNone(r["migracoes"])
        self.assertGreater(len(r["bloqueios"]), 0)
        self.assertFalse(r["backupRestauravelComprovado"])

    def test_ocupacao_de_caches_e_apenas_agregada_e_sem_conteudo(self):
        consultas = []
        def executar(args):
            consultas.append(args)
            return None
        with tempfile.TemporaryDirectory() as d, patch.object(inspecao, "executar", side_effect=executar):
            r = inspecao.inspecionar(Path(d), "barberos")
        self.assertIn("/root/.npm/_cacache", r["ocupacaoCaches"])
        self.assertIn("/var/log/journal", r["ocupacaoCaches"])
        for p in r["ocupacaoCaches"]:
            self.assertIn(["du", "-x", "-s", "-B1", p], consultas)
        self.assertFalse(any(a in {"cat", "tail", "rm", "prune"} for args in consultas for a in args))

    def test_consulta_do_banco_permite_somente_select_e_nao_ler_env(self):
        consultas = []
        banco = {"Id": "b" * 64, "Config": {"Labels": {"com.docker.compose.service": "db"}}, "State": {"Running": True}}

        def executar(args):
            consultas.append(args)
            if args[:3] == ["docker", "ps", "-aq"]:
                return banco["Id"]
            if args[:2] == ["docker", "inspect"]:
                return json.dumps([banco])
            if args[:2] == ["docker", "exec"]:
                self.assertTrue(args[-1].startswith("SELECT "))
                self.assertNotIn("logs", args[-1])
                return "[]"
            return "versao"

        with tempfile.TemporaryDirectory() as d, patch.object(inspecao, "executar", side_effect=executar):
            r = inspecao.inspecionar(Path(d), "barberos")
        self.assertEqual(r["migracoes"], [])
        self.assertTrue(r["somenteLeitura"])
        self.assertFalse(any(a in {"stop", "start", "up", "down", "cp", "build", "pull", "prune"} for args in consultas for a in args))
