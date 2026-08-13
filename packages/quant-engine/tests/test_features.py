import unittest
import pandas as pd
import numpy as np
import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(__file__)))
from features.feature_engine import calculate_features

class TestFeatures(unittest.TestCase):
    def test_no_lookahead(self):
        df = pd.DataFrame({
            'Open': np.random.randn(100) + 100, 
            'High': np.random.randn(100) + 105, 
            'Low': np.random.randn(100) + 95, 
            'Close': np.random.randn(100) + 100, 
            'Volume': np.random.randint(1000, 5000, 100)
        })
        res = calculate_features(df)
        self.assertTrue('rsi_14' in res.columns)
        self.assertFalse(res['rsi_14'].isna().all())

if __name__ == '__main__':
    unittest.main()
