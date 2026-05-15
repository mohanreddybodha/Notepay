import sys
with open('backend/main.py', 'rb') as f:
    content = f.read().decode('utf-8')
    lines = content.split('\n')
    for i, line in enumerate(lines[300:320], 301):
        print(f"{i:4}: {repr(line)}")
