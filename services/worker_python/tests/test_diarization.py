import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.diarization import label_segments, participant_names  # noqa: E402
from app.schemas import Segment  # noqa: E402


def make_segments(count: int) -> list[Segment]:
    return [Segment(id=f"s{index}", sequence_no=index, start_ms=index * 1000, end_ms=(index + 1) * 1000, text=f"Text {index}") for index in range(count)]


class DiarizationTests(unittest.TestCase):
    def test_extracts_named_participants_without_roles(self):
        self.assertEqual(participant_names("Participants: Dana (product), Noam (engineering). Project: Acme"), ["Dana", "Noam"])

    def test_context_names_force_two_acoustic_speakers(self):
        segments = make_segments(4)
        embeddings = np.asarray([
            [0.0, 0.1, 0.0],
            [5.0, 5.1, 5.0],
            [0.1, 0.0, 0.1],
            [5.1, 5.0, 4.9],
        ], dtype=np.float32)
        used = label_segments(segments, embeddings, "People: Dana, Noam · product launch")
        self.assertTrue(used)
        self.assertEqual([segment.speaker_label for segment in segments], ["Dana", "Noam", "Dana", "Noam"])


if __name__ == "__main__":
    unittest.main()
