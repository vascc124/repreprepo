from pathlib import Path
import re

path = Path("embyClient.js")
data = path.read_text(encoding="utf-8")
pattern = re.compile(r"function parseLibraryCatalogId\(rawId\) \{.*?\n\}", re.DOTALL)
match = pattern.search(data)
if not match:
    raise SystemExit("parseLibraryCatalogId not found")
replacement = "function parseLibraryCatalogId(rawId) {\n    if (!rawId || typeof rawId !== 'string') {\n        return { libraryId: rawId, mode: 'all' };\n    }\n    const [libraryId, modeToken] = rawId.split('::');\n    const mode = modeToken === 'favorites' ? 'all' : (modeToken || 'all');\n    return { libraryId, mode };\n}"
data = data[:match.start()] + replacement + data[match.end():]
path.write_text(data, encoding="utf-8")
