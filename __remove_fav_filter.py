from pathlib import Path
path = Path('embyClient.js')
text = path.read_text(encoding='utf-8')
snippet = "    if (mode === 'favorites') {\r\n        params.Filters = params.Filters ? ${params.Filters},IsFavorite : 'IsFavorite';\r\n    }\r\n"
if snippet not in text:
    snippet = "    if (mode === 'favorites') {\n        params.Filters = params.Filters ? ${params.Filters},IsFavorite : 'IsFavorite';\n    }\n"
    if snippet not in text:
        raise SystemExit('favorites snippet not found')
text = text.replace(snippet, '\n')
path.write_text(text, encoding='utf-8')
