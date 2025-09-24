from pathlib import Path
text = Path('embyClient.js').read_text(encoding='utf-8')
start = text.find("if (mode === 'favorites')")
print(text[start:start+80])
