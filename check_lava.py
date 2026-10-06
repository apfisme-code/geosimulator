"""Quick checks for the lava-cooling fix."""
import re

src = open('js/sim.js', encoding='utf-8').read()
print('sim.js:')
print('    LAVA_COOL_RATE imported:', 'LAVA_COOL_RATE' in src)
print('    stepLavaCool defined:   ', 'function stepLavaCool' in src)
print("    lava_cool in STEPS:     ", re.search(r"name:\s*'lava_cool'", src) is not None)
print('    lavaBonus NOT drifted:  ', 'Lava drifts with the plate' not in src)
print('    stepRelax uses lb:      ', 'target + lb - surface' in src)

src = open('js/volcano.js', encoding='utf-8').read()
print('volcano.js:')
print('    H4 += addH removed:     ', 'H4[kk] += addH' not in src)
print('    lavaBonus still added:  ', 'lavaBonus[kk] += addH' in src)

src = open('js/plates.js', encoding='utf-8').read()
print('plates.js:')
print('    lavaBonus NOT in target:', 'TGT2[k] += LBO[k]' not in src)

src = open('js/constants.js', encoding='utf-8').read()
print('constants.js:')
print('    COOL_RATE in VOLCANO:   ', 'COOL_RATE:' in src)