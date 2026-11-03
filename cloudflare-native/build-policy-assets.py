"""Copy the existing, approved policy text without executing the Flask app."""
import ast
import json
from pathlib import Path
root = Path(__file__).resolve().parent
module = ast.parse((root.parent / 'legal_policies.py').read_text(encoding='utf-8'))
policies = next(ast.literal_eval(node.value) for node in module.body
                if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'POLICIES' for t in node.targets))
(root / 'public/assets/policies.json').write_text(json.dumps(policies, ensure_ascii=False), encoding='utf-8')
(root / 'public/assets/radiolavoixdivine.png').write_bytes((root.parent / 'static/logos/radiolavoixdivine.png').read_bytes())
print('Existing policy text and player artwork copied; no private records included.')
