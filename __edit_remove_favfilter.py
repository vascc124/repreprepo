from pathlib import Path
import re

path = Path('embyClient.js')
data = path.read_text(encoding='utf-8')
pattern = re.compile(r"\n\s*if \(mode === 'favorites'\) \{\n\s*params.Filters = params.Filters \? `${params.Filters},IsFavorite` : 'IsFavorite';\n\s*\}\n", re.MULTILINE)
data = pattern.sub('\n', data)
path.write_text(data, encoding='utf-8')
