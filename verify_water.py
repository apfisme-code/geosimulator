import re
src = open('js/render.js', encoding='utf-8').read()
m = re.search(r'const waterFS = `(.*?)`;', src, re.DOTALL)
body = m.group(1)
print('waterFS has uFogColor decl:', 'uniform vec3  uFogColor' in body)
main = body.split('void main', 1)[1]
print('waterFS main uses uFogColor:', 'uFogColor' in main)