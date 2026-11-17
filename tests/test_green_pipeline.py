import importlib.util
from pathlib import Path
import unittest
import numpy as np

spec = importlib.util.spec_from_file_location('green', Path(__file__).resolve().parents[1] / 'tools/process-green.py')
green = importlib.util.module_from_spec(spec)
spec.loader.exec_module(green)


class KeyTests(unittest.TestCase):
    def test_green_transparent_red_and_white_opaque(self):
        keyed = green.key_rgba(np.uint8([[[0, 255, 0], [50, 50, 240], [255, 255, 255], [0, 0, 0]]]))
        self.assertEqual(keyed[0, :, 3].tolist(), [0, 255, 255, 255])
        self.assertEqual(keyed[0, 1, :3].tolist(), [240, 50, 50])

    def test_fixed_registration(self):
        anchor = np.zeros((720, 1280, 4), np.uint8)
        anchor[144:612, 500:780] = [220, 80, 80, 255]
        result = green.normalize(anchor, green.registration(anchor, "standing"))
        box = green.body_metrics(result)
        self.assertLessEqual(abs(box["y0"] - 61), 1)
        self.assertLessEqual(abs(box["y1"] - 306), 1)
        self.assertLessEqual(abs((box["x0"] + box["x1"]) / 2 - 326), 1)

    def test_largest_component_excludes_detached_effect(self):
        frame = np.zeros((200, 300, 4), np.uint8)
        frame[50:180, 100:200, 3] = 255
        frame[10:30, 250:270, 3] = 255
        box = green.body_metrics(frame)
        self.assertEqual(
            (box["x0"], box["y0"], box["x1"], box["y1"]),
            (100, 50, 200, 180),
        )
        self.assertEqual(box["components"], 2)


if __name__ == '__main__':
    unittest.main()
