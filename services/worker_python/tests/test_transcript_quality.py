import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.schemas import Segment  # noqa: E402
from app.transcript_quality import sanitize_segments, sanitize_transcript_text  # noqa: E402


class TranscriptQualityTests(unittest.TestCase):
    def test_collapses_large_consecutive_line_loop_and_flags_generic_speaker(self):
        transcript = "\n".join(["Speaker 1: אני חושבת שאני חושבת את זה"] * 100)
        result = sanitize_transcript_text(transcript)

        self.assertEqual(len(result.transcript.splitlines()), 2)
        self.assertTrue(any("98" in note and "transcript" in note.lower() for note in result.notes))
        self.assertTrue(any("Speaker 1" in note and "not reliable" in note for note in result.notes))

    def test_does_not_collapse_short_human_repetition(self):
        transcript = "\n".join(["Speaker 1: yes, I understand"] * 3)
        result = sanitize_transcript_text(transcript)

        self.assertEqual(len(result.transcript.splitlines()), 3)
        self.assertFalse(any("near-identical" in note for note in result.notes))

    def test_collapses_phrase_loop_inside_one_line_but_preserves_two_repetitions(self):
        phrase = "אני חושבת שאני חושבת את זה"
        result = sanitize_transcript_text("Speaker 1: " + " ".join([phrase] * 8))

        self.assertLess(len(result.transcript.split()), 8 * len(phrase.split()) + 2)
        self.assertTrue(any("phrase-loop" in note for note in result.notes))

    def test_collapses_duplicate_asr_segments_and_resequences(self):
        segments = [
            Segment(
                id=f"s{index}",
                sequence_no=index,
                start_ms=index * 1000,
                end_ms=(index + 1) * 1000,
                text="אני חושבת שאני חושבת את זה",
                confidence=0.9,
            )
            for index in range(8)
        ]

        cleaned, notes = sanitize_segments(segments)

        self.assertEqual(len(cleaned), 2)
        self.assertEqual([segment.sequence_no for segment in cleaned], [0, 1])
        self.assertTrue(any("6 duplicate ASR segments" in note for note in notes))


if __name__ == "__main__":
    unittest.main()
