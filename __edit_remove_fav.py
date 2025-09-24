from pathlib import Path
import re

path = Path('embyClient.js')
data = path.read_text(encoding='utf-8')
pattern = re.compile(r"\n\s*definitions\.push\(\{\s*\n\s*libraryId: `\$\{view\.Id\}::favorites`,\s*\n\s*type,\s*\n\s*name: `\$\{baseName\} \(Favorites\)`\s*\n\s*\}\);", re.MULTILINE)
if not pattern.search(data):
    raise SystemExit('favorites block not found')
data = pattern.sub('', data)
path.write_text(data, encoding='utf-8')
