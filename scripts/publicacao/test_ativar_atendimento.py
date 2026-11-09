import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import ativar_atendimento as a


class AtivarAtendimentoTest(unittest.TestCase):
    def test_prova_bundle_vai_por_stdin_sem_depender_de_sdk_externalizado(self):
        with patch.object(a, 'MODELO', 'bundle-sintetico'), patch.object(a, 'executar', return_value=b'{"modeloRespondeu":true,"sdkExternalizado":false}') as executar:
            self.assertTrue(a.provar_modelo({'Id': 'app'})['modeloRespondeu'])
            cmd = executar.call_args.args[0]
            self.assertEqual(cmd, ['docker', 'exec', '-i', 'app', 'node'])
            self.assertIn(b'bundle-sintetico', executar.call_args.kwargs['entrada'])
            self.assertIn(b"BARBEROS_PROVA_IA='mensagem'", executar.call_args.kwargs['entrada'])
            executar.return_value = b'{"modeloRespondeu":false,"status":401,"motivo":"chave_invalida"}'
            with self.assertRaisesRegex(RuntimeError, '401.*chave_invalida'):
                a.provar_modelo({'Id': 'app'})

    def test_rejeita_publicacao_incompleta_antes_de_docker(self):
        with tempfile.TemporaryDirectory() as d, patch.object(a, 'exigir_sem_recuperacao'), patch.object(a, 'executar') as executar:
            base = Path(d); pasta = base / 'releases' / ('a' * 40); pasta.mkdir(parents=True)
            (pasta / 'operacao.json').write_text(json.dumps({'concluido': False}))
            with self.assertRaisesRegex(RuntimeError, 'não comprovada'):
                a.ativar(base, 'barberos', 'a' * 40)
            executar.assert_not_called()

    def test_rejeita_versao_diferente_sem_alterar_instalacao(self):
        with tempfile.TemporaryDirectory() as d, patch.object(a, 'exigir_sem_recuperacao'), patch.object(a, 'aguardar_saude', return_value={}), patch.object(a, 'ambiente_container', return_value={'BARBEROS_REVISAO': 'b' * 40}), patch.object(a, 'executar') as executar:
            base = Path(d); pasta = base / 'releases' / ('a' * 40); pasta.mkdir(parents=True)
            (pasta / 'operacao.json').write_text(json.dumps({'concluido': True, 'revisao': 'a' * 40}))
            with self.assertRaisesRegex(RuntimeError, 'mudou'):
                a.ativar(base, 'barberos', 'a' * 40)
            executar.assert_not_called()

    def test_preflight_so_le_configuracao_e_conexao_sem_mensagem_ou_modelo(self):
        self.assertIn("p.usuario.count", a.PREFLIGHT)
        self.assertIn("connectionState", a.PREFLIGHT)
        self.assertNotIn("/message/send", a.PREFLIGHT)
        self.assertNotIn("messages.create", a.PREFLIGHT)
        self.assertNotIn(".update(", a.PREFLIGHT)


if __name__ == '__main__':
    unittest.main()
