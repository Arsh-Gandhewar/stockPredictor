# Walk-Forward Cross-Validation Methodology (docs/WALK_FORWARD_METHODOLOGY.md)

## 1. Rolling Partition Architecture
To prevent lookahead and data snooping bias, model evaluation strictly follows 4 rolling walk-forward folds plus an untouched holdout partition:

- **Fold Structure**:
  - **Training Window**: 24 months of historical daily candles.
  - **Validation Window**: 6 months of out-of-fold data (used exclusively for early stopping & isotonic calibration fitting).
  - **Test Window**: 6 months of true out-of-sample data (used exclusively for performance metrics reporting).
  - **Step Size**: Advances forward by 6 months per fold.
- **Untouched Holdout Partition**: Final 6 months (2026-03-01 to 2026-08-22) reserved untouched during research hyperparameter tuning to assess true production generalization.

```
Fold 1: [--- 24m Train ---][ 6m Val ][ 6m Test ]
Fold 2:       [--- 24m Train ---][ 6m Val ][ 6m Test ]
Fold 3:             [--- 24m Train ---][ 6m Val ][ 6m Test ]
Fold 4:                   [--- 24m Train ---][ 6m Val ][ 6m Test ]
Holdout:                                                        [ 6m Holdout ]
```

## 2. Invariant Rules
- Feature scaling, mean computation, and quantile calculations are fit strictly on the training partition of each fold and applied downstream.
- No future observations are ever present in training or validation matrices.
