"""Make writing_automation (parent dir) and dashboard scripts importable in tests."""
import sys
from pathlib import Path

DASHBOARD = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(DASHBOARD))
sys.path.insert(0, str(DASHBOARD.parent))
