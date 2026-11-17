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
        result = green.normalize(anchor, green.registration(anchor))
        box = green.bbox(result)
        self.assertLessEqual(abs(box[1] - 72), 1)
        self.assertLessEqual(abs(box[3] - 306), 1)


if __name__ == '__main__':
    unittest.main()
