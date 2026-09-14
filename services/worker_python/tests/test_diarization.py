import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.diarization import (  # noqa: E402
    apply_explicit_speaker_names,
    assign_turns_by_overlap,
    expected_speaker_count,
    label_segments,
    participant_names,
)
from app.schemas import Segment  # noqa: E402


def make_segments(count: int) -> list[Segment]:
    return [
        Segment(id=f"s{index}", sequence_no=index, start_ms=index * 1000, end_ms=(index + 1) * 1000, text=f"Text {index}")
        for index in range(count)
    ]


class DiarizationTests(unittest.TestCase):
    def test_extracts_named_participants_for_count_only(self):
        self.assertEqual(participant_names("Participants: Dana (product), Noam (engineering). Project: Acme"), ["Dana", "Noam"])
        self.assertEqual(expected_speaker_count("Participants: Dana, Noam"), 2)

    def test_explicit_count_overrides_context(self):
        self.assertEqual(expected_speaker_count("Participants: Dana, Noam", 3), 3)
        self.assertEqual(expected_speaker_count("Speaker count: 2"), 2)

    def test_context_names_force_two_acoustic_speakers_but_do_not_guess_identity(self):
        segments = make_segments(4)
        embeddings = np.asarray([
            [0.0, 0.1, 0.0],
            [5.0, 5.1, 5.0],
            [0.1, 0.0, 0.1],
            [5.1, 5.0, 4.9],
        ], dtype=np.float32)
        used = label_segments(segments, embeddings, "People: Dana, Noam · product launch")
        self.assertTrue(used)
        self.assertEqual([segment.speaker_label for segment in segments], ["Speaker 1", "Speaker 2", "Speaker 1", "Speaker 2"])

    def test_overlap_alignment_uses_most_audio_not_midpoint_only(self):
        segments = [Segment(id="s", sequence_no=0, start_ms=0, end_ms=3000, text="hello")]
        used = assign_turns_by_overlap(segments, [(0, 1900, "A"), (1900, 3000, "B")])
        self.assertFalse(used)
        self.assertEqual(segments[0].speaker_label, "Speaker 1")

    def test_overlap_alignment_separates_two_speakers(self):
        segments = [
            Segment(id="s1", sequence_no=0, start_ms=0, end_ms=1500, text="a"),
            Segment(id="s2", sequence_no=1, start_ms=1500, end_ms=3000, text="b"),
        ]
        used = assign_turns_by_overlap(segments, [(0, 1400, "A"), (1400, 3000, "B")])
        self.assertTrue(used)
        self.assertEqual([segment.speaker_label for segment in segments], ["Speaker 1", "Speaker 2"])

    def test_names_require_explicit_mapping(self):
        segments = make_segments(2)
        segments[1].speaker_label = "Speaker 2"
        apply_explicit_speaker_names(segments, "People: Moshe, Client")
        self.assertEqual([s.speaker_label for s in segments], ["Speaker 1", "Speaker 2"])
        apply_explicit_speaker_names(segments, "Speaker 1 = Moshe; Speaker 2 = Client")
        self.assertEqual([s.speaker_label for s in segments], ["Moshe", "Client"])


if __name__ == "__main__":
    unittest.main()
