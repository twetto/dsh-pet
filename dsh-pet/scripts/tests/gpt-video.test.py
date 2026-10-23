import importlib.util
from pathlib import Path
import unittest

import numpy as np

spec = importlib.util.spec_from_file_location('prepare_gpt_video', Path(__file__).resolve().parents[1] / 'prepare-gpt-video.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
stabilize_spec = importlib.util.spec_from_file_location('stabilize_gpt_source', Path(__file__).resolve().parents[1] / 'stabilize-gpt-source.py')
stabilize_module = importlib.util.module_from_spec(stabilize_spec)
stabilize_spec.loader.exec_module(stabilize_module)
loop_spec = importlib.util.spec_from_file_location('loop_gpt_video', Path(__file__).resolve().parents[1] / 'loop-gpt-video.py')
loop_module = importlib.util.module_from_spec(loop_spec)
loop_spec.loader.exec_module(loop_module)
aa_spec = importlib.util.spec_from_file_location('antialias_gpt_video', Path(__file__).resolve().parents[1] / 'antialias-gpt-video.py')
aa_module = importlib.util.module_from_spec(aa_spec)
aa_spec.loader.exec_module(aa_module)
temporal_spec = importlib.util.spec_from_file_location('temporal_gpt_video', Path(__file__).resolve().parents[1] / 'temporal-gpt-video.py')
temporal_module = importlib.util.module_from_spec(temporal_spec)
temporal_spec.loader.exec_module(temporal_module)
sampling_spec = importlib.util.spec_from_file_location('sample_gpt_video', Path(__file__).resolve().parents[1] / 'sample-gpt-video.py')
sampling_module = importlib.util.module_from_spec(sampling_spec)
sampling_spec.loader.exec_module(sampling_module)


class GreenKeyTests(unittest.TestCase):
    def test_removes_green_without_erasing_white_or_lavender(self):
        frame = np.full((40, 80, 3), [12, 151, 69], dtype=np.uint8)
        frame[20, 20] = [245, 240, 255]
        frame[20, 21] = [170, 140, 220]
        rgba = module.key_frame(frame)
        self.assertEqual(int(rgba[0, 0, 3]), 0)
        self.assertEqual(int(rgba[20, 20, 3]), 255)
        self.assertEqual(int(rgba[20, 21, 3]), 255)
        np.testing.assert_array_equal(rgba[20, 20, :3], frame[20, 20])

    def test_mixed_green_edge_gets_partial_alpha(self):
        frame = np.full((40, 80, 3), [12, 151, 69], dtype=np.uint8)
        frame[20, 20] = [120, 150, 125]
        alpha = int(module.key_frame(frame)[20, 20, 3])
        self.assertGreater(alpha, 0)
        self.assertLess(alpha, 255)


class StabilizationTests(unittest.TestCase):
    def test_baseline_ignores_faint_edge_and_rejects_empty_frames(self):
        frame = np.zeros((32, 32, 4), dtype=np.uint8)
        frame[4:24, 8:16, 3] = 255
        frame[24:28, 8:16, 3] = 127
        self.assertEqual(stabilize_module.foot_baseline(frame), 24)
        with self.assertRaises(ValueError):
            stabilize_module.foot_baseline(np.zeros_like(frame))

    def test_smoothing_preserves_constant_and_reduces_correction_steps(self):
        np.testing.assert_allclose(module.smooth_corrections([2] * 40), 2)
        trajectory = module.smooth_corrections([0] * 20 + [1] * 20)
        self.assertEqual(len(trajectory), 40)
        self.assertLess(float(np.max(np.abs(np.diff(trajectory)))), 0.25)
        self.assertGreaterEqual(float(trajectory.min()), 0)
        self.assertLessEqual(float(trajectory.max()), 1)
        self.assertTrue(np.any((trajectory > 0) & (trajectory < 1)))
        with self.assertRaises(ValueError):
            module.smooth_corrections([])

    def test_fractional_translation_preserves_foreground_color_and_alpha(self):
        frame = np.zeros((16, 16, 4), dtype=np.uint8)
        frame[4:8, 4:8] = [200, 150, 255, 255]
        result = module.translate_subpixel(frame, 0, 0.5, 16, 16)
        visible = result[:, :, 3] > 0
        self.assertTrue(np.any((result[:, :, 3] > 0) & (result[:, :, 3] < 255)))
        np.testing.assert_array_equal(result[:, :, :3][visible], np.tile([200, 150, 255], (visible.sum(), 1)))
        rows = np.arange(16)[:, None]
        centroid = float((rows * result[:, :, 3]).sum() / result[:, :, 3].sum())
        self.assertAlmostEqual(centroid, 6.0, places=2)


class AntiAliasTests(unittest.TestCase):
    def test_contour_softens_without_dark_fringe_or_interior_blur(self):
        frame = np.zeros((32, 32, 4), dtype=np.uint8)
        frame[8:24, 8:24] = [240, 220, 255, 255]
        frame[14:18, 14:18] = [60, 40, 90, 255]
        result = aa_module.antialias_frame(frame, 32, 32)
        np.testing.assert_array_equal(result[12:20, 12:20], frame[12:20, 12:20])
        partial = (result[:, :, 3] > 0) & (result[:, :, 3] < 255)
        self.assertTrue(np.any(partial))
        np.testing.assert_array_equal(result[:, :, :3][partial], np.tile([240, 220, 255], (partial.sum(), 1)))
        self.assertEqual(int(result[0, 0, 3]), 0)

    def test_downsample_uses_partial_coverage(self):
        frame = np.zeros((12, 12, 4), dtype=np.uint8)
        frame[3:9, 3:9] = [200, 150, 255, 255]
        result = aa_module.antialias_frame(frame, 6, 6)
        self.assertEqual(result.shape, (6, 6, 4))
        self.assertTrue(np.any((result[:, :, 3] > 0) & (result[:, :, 3] < 255)))


class SamplingTests(unittest.TestCase):
    def test_master_preserves_pixels_and_resize_preserves_edge_color(self):
        frame = np.zeros((12, 12, 4), dtype=np.uint8)
        frame[3:9, 3:9] = [240, 220, 255, 255]
        np.testing.assert_array_equal(sampling_module.resize_coverage(frame, 12, 12), frame)
        result = sampling_module.resize_coverage(frame, 6, 6)
        visible = result[:, :, 3] > 0
        np.testing.assert_array_equal(result[:, :, :3][visible], np.tile([240, 220, 255], (visible.sum(), 1)))


class TemporalMatteTests(unittest.TestCase):
    def test_translation_alignment_and_reverse_consistency(self):
        current = np.zeros((24, 24, 4), dtype=np.uint8)
        neighbor = current.copy()
        current[8:16, 6:14] = [240, 220, 255, 255]
        neighbor[8:16, 8:16] = [240, 220, 255, 255]
        flow = np.zeros((24, 24, 2), dtype=np.float32)
        flow[:, :, 0] = 2
        aligned, confidence = temporal_module.align_neighbor(neighbor, flow, -flow)
        np.testing.assert_allclose(aligned[8:16, 6:14, 3], 1)
        np.testing.assert_allclose(confidence[8:16, 6:14], 1)
        result = temporal_module.filter_matte(current, [(aligned, confidence)])
        np.testing.assert_array_equal(result, current)
        _, rejected = temporal_module.align_neighbor(neighbor, flow, flow)
        self.assertLess(float(rejected[12, 10]), 0.001)

    def test_alpha_noise_reduces_without_blurring_interior_or_rgb(self):
        current = np.zeros((24, 24, 4), dtype=np.uint8)
        current[6:18, 6:18] = [240, 220, 255, 255]
        current[6, 6:18, 3] = 150
        neighbor = current.astype(np.float32) / 255
        neighbor[6, 6:18, 3] = 130 / 255
        confidence = np.ones((24, 24), dtype=np.float32)
        result = temporal_module.filter_matte(current, [(neighbor, confidence), (neighbor, confidence)])
        self.assertLess(int(result[6, 10, 3]), 150)
        self.assertGreater(int(result[6, 10, 3]), 130)
        np.testing.assert_array_equal(result[:, :, :3], current[:, :, :3])
        np.testing.assert_array_equal(result[9:15, 9:15], current[9:15, 9:15])

    def test_new_partial_coverage_borrows_color_without_black_fringe(self):
        current = np.zeros((24, 24, 4), dtype=np.uint8)
        current[6:18, 6:18] = [240, 220, 255, 255]
        neighbor = current.astype(np.float32) / 255
        neighbor[6:18, 5] = [240 / 255, 220 / 255, 1, 0.1]
        result = temporal_module.filter_matte(current, [(neighbor, np.ones((24, 24), dtype=np.float32))])
        self.assertGreater(int(result[10, 5, 3]), 0)
        np.testing.assert_array_equal(result[10, 5, :3], [240, 220, 255])

    def test_unreliable_flow_and_occlusion_do_not_leave_ghosts(self):
        current = np.zeros((24, 24, 4), dtype=np.uint8)
        current[6:18, 6:18] = [240, 220, 255, 255]
        neighbor = np.ones((24, 24, 4), dtype=np.float32)
        confidence = np.ones((24, 24), dtype=np.float32)
        result = temporal_module.filter_matte(current, [(neighbor, confidence)])
        np.testing.assert_array_equal(result, current)
        result = temporal_module.filter_matte(current, [(neighbor, confidence * 0)])
        np.testing.assert_array_equal(result, current)


class OpticalFlowTests(unittest.TestCase):
    def test_endpoint_search_uses_same_premultiplied_thumbnails(self):
        frames = np.zeros((192, 8, 8, 4), dtype=np.uint8)
        frames[:, 2:6, 2:6] = [240, 220, 255, 255]
        small = np.stack([loop_module.cv2.resize(loop_module.premultiply(frame), (96, 96), interpolation=loop_module.cv2.INTER_AREA) for frame in frames])
        self.assertEqual(loop_module.choose_endpoints(frames, 24), loop_module.choose_small_endpoints(small, 24))
        with self.assertRaises(ValueError):
            loop_module.choose_small_endpoints(small[:24], 24)

    def test_known_translation_moves_shape_without_a_double_image(self):
        first = np.zeros((32, 32, 4), dtype=np.uint8)
        last = first.copy()
        first[10:18, 8:16] = [240, 220, 255, 255]
        last[10:18, 12:20] = [240, 220, 255, 255]
        forward = np.zeros((32, 32, 2), dtype=np.float32)
        forward[:, :, 0] = 4
        result = loop_module.warp_between(first, last, forward, -forward, 0.5)
        expected = np.zeros_like(first)
        expected[10:18, 10:18] = [240, 220, 255, 255]
        np.testing.assert_array_equal(result, expected)
        np.testing.assert_array_equal(loop_module.warp_between(first, last, forward, -forward, 0), first)
        np.testing.assert_array_equal(loop_module.warp_between(first, last, forward, -forward, 1), last)


if __name__ == '__main__':
    unittest.main()
