import os
import json

def export_artifacts(model_json, calibration_json, feature_config, metrics, base_path):
    os.makedirs(base_path, exist_ok=True)
    
    with open(os.path.join(base_path, 'model_v1.json'), 'w') as f:
        json.dump(model_json, f, indent=2)
        
    with open(os.path.join(base_path, 'calibration_v1.json'), 'w') as f:
        json.dump(calibration_json, f, indent=2)
        
    with open(os.path.join(base_path, 'feature_config_v1.json'), 'w') as f:
        json.dump(feature_config, f, indent=2)
        
    with open(os.path.join(base_path, 'backtest_results_v1.json'), 'w') as f:
        json.dump(metrics, f, indent=2)
        
    print(f"Artifacts exported to {base_path}")
