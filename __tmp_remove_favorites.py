from pathlib import Path
text = Path('embyClient.js').read_text(encoding='utf-8')
old = "            definitions.push({\n                libraryId: `${view.Id}::lastAdded`,\n                type,\n                name: `${baseName} (Last Added)`\n            });\n            definitions.push({\n                libraryId: `${view.Id}::favorites`,\n                type,\n                name: `${baseName} (Favorites)`\n            });"
new = "            definitions.push({\n                libraryId: `${view.Id}::lastAdded`,\n                type,\n                name: `${baseName} (Last Added)`\n            });"
if old not in text:
    raise SystemExit('favorites block not found')
Path('embyClient.js').write_text(text.replace(old, new), encoding='utf-8')
