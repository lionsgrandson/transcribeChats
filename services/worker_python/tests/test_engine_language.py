import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.engine import detect_text_language  # noqa: E402


class EngineLanguageTests(unittest.TestCase):
    def test_detects_hebrew(self):
        self.assertEqual(detect_text_language("שלום, מה שלומך?"), "he")

    def test_detects_english(self):
        self.assertEqual(detect_text_language("Hello, how are you?"), "en")

    def test_detects_mixed_language(self):
        self.assertEqual(detect_text_language("בוא נבדוק the deployment status"), "mixed")


if __name__ == "__main__":
    unittest.main()
