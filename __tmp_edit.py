lines = []
import pathlib
path = pathlib.Path('embyClient.js')
with path.open('r', encoding='utf-8') as f:
    for line in f:
        lines.append(line)
result = []
skip = 0
for line in lines:
    if skip > 0:
        skip -= 1
        continue
    if '${view.Id}::favorites' in line:
        skip = 3  # skip type line, name line, closing line
        continue
    result.append(line)
path.write_text(''.join(result), encoding='utf-8')
