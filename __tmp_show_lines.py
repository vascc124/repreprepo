from pathlib import Path
lines = Path('embyClient.js').read_text(encoding='utf-8').splitlines()
start = 440
end = 560
for idx in range(start, min(end, len(lines))):
    print(f"{idx+1}: {lines[idx]}")
