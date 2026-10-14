import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.analysis import _ai
from app.schemas import Analysis


class ProviderSelectionTests(unittest.IsolatedAsyncioTestCase):
    async def test_explicit_ollama_never_sends_to_gemini(self):
        result = Analysis(summary='Local result', items=[])
        with patch('app.analysis._ollama', new_callable=AsyncMock, return_value=result) as local:
            with patch('app.analysis._gemini', new_callable=AsyncMock) as cloud:
                self.assertEqual(await _ai(None, 'Synthetic prompt', {}, 'ollama'), result)
                local.assert_awaited_once()
                cloud.assert_not_awaited()

    async def test_explicit_gemini_does_not_silently_fall_back(self):
        with patch('app.analysis._gemini', new_callable=AsyncMock, side_effect=RuntimeError('Quota')):
            with patch('app.analysis._ollama', new_callable=AsyncMock) as local:
                with self.assertRaisesRegex(RuntimeError, 'Quota'):
                    await _ai(None, 'Synthetic prompt', {}, 'gemini')
                local.assert_not_awaited()
