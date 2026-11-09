import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import ativar_atendimento as a


class AtivarAtendimentoTest(unittest.TestCase):
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
