import unittest
import pandas as pd
import sys
import os
import numpy as np
sys.path.append(os.path.dirname(os.path.dirname(__file__)))
from targets.target_definition import compute_targets

class TestTargets(unittest.TestCase):
    def test_target_calculation(self):
        df = pd.DataFrame({'Close': [100, 101, 105, 95, 110]})
        res = compute_targets(df)
        self.assertTrue('target_1d' in res.columns)
        # Verify the last element is NaN due to lack of future data
        self.assertTrue(np.isnan(res['target_1d'].iloc[-1]))

if __name__ == '__main__':
    unittest.main()
