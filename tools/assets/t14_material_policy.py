"""Explicit material policies; preserve geometry, binary payload and node transforms."""
import json
import struct

KNOWN_POLICIES = ('preserve', 'double-sided-thin-surfaces', 'non-metallic-flat-color', 'skin-tone-override')
# User ruling 2026-09-23: characters ship the t2 skin tone; t1-t6+orig stay available for the
# future runtime color-variant feature. Conversions must keep the material name recognizable.
SKIN_MATERIAL = 'Skin'
SKIN_TONES = {'t1': '#F6DCC6', 't2': '#E8BE9A', 't3': '#D4A27C', 't4': '#B7835C', 't5': '#8A5A3C', 't6': '#5A3A28'}


def _srgb_channel_to_linear(value):
    channel = int(value, 16) / 255
    return round(((channel + 0.055) / 1.055) ** 2.4 if channel > 0.04045 else channel / 12.92, 6)


def _skin_default_factor():
    tone = SKIN_TONES['t2']
    return [_srgb_channel_to_linear(tone[i:i + 2]) for i in (1, 3, 5)] + [1]


def apply_material_policy(output, policy):
    policies = [policy] if isinstance(policy, str) else list(policy)
    if not policies:
        raise ValueError('Empty material policy')
    unknown = [p for p in policies if p not in KNOWN_POLICIES]
    if unknown:
        raise ValueError('Unknown material policy: ' + unknown[0])
    active = [p for p in policies if p != 'preserve']
    if not active:
        return output
    magic, version, length, size, kind = struct.unpack_from('<IIIII', output)
    if (magic, version, length, kind) != (0x46546c67, 2, len(output), 0x4e4f534a):
        raise ValueError('Invalid GLB')
    doc = json.loads(output[20:20 + size])
    if not doc.get('materials'):
        raise ValueError('Material policy requires materials')
    for name in active:
        if name == 'skin-tone-override':
            targets = [m for m in doc['materials'] if m.get('name') == SKIN_MATERIAL]
            if not targets:
                raise ValueError('skin-tone-override requires a material named ' + SKIN_MATERIAL)
            for material in targets:
                material.setdefault('pbrMetallicRoughness', {})['baseColorFactor'] = _skin_default_factor()
            continue
        for material in doc['materials']:
            if name == 'double-sided-thin-surfaces':
                material['doubleSided'] = True
            else:
                material.setdefault('pbrMetallicRoughness', {})['metallicFactor'] = 0
    raw = json.dumps(doc, separators=(',', ':'), ensure_ascii=True).encode()
    raw += b' ' * (-len(raw) % 4)
    tail = output[20 + size:]
    return (struct.pack('<IIIII', magic, version, 20 + len(raw) + len(tail), len(raw), kind)
            + raw + tail)
