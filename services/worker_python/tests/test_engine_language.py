import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.engine import _transcribe_sync, detect_text_language  # noqa: E402


class FakeWhisperModel:
    options = None

    def transcribe(self, path, **options):
        FakeWhisperModel.options = options
        return iter([]), SimpleNamespace(language="en", duration=0)


class EngineLanguageTests(unittest.TestCase):
    def test_detects_hebrew(self):
        self.assertEqual(detect_text_language("שלום, מה שלומך?"), "he")

    def test_detects_english(self):
        self.assertEqual(detect_text_language("Hello, how are you?"), "en")

    def test_detects_mixed_language(self):
        self.assertEqual(detect_text_language("בוא נבדוק the deployment status"), "mixed")

    def test_context_is_sent_to_whisper_as_spelling_guidance(self):
        with patch("app.engine._get_model", return_value=FakeWhisperModel()):
            _transcribe_sync(Path("meeting.m4a"), "mixed", "People: Dana and Noam. Product: Acme")
        prompt = FakeWhisperModel.options["initial_prompt"]
        self.assertIn("Dana and Noam", prompt)
        self.assertIn("Acme", prompt)


if __name__ == "__main__":
    unittest.main()
