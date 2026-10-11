"""Pack table and Traditional Chinese display names for the Quaternius MegaKit import (megakits-v1).

Names are composed token by token from the source file names; any token without a translation stays in English so
nothing is silently mistranslated. The English file stem is always kept in the catalog `origin`.
"""
import re

CC0_NOTE = 'Quaternius MegaKit (Standard) CC0 1.0'
PACKS = [
    {'code': 'FP', 'folder': 'Fantasy_Props_MegaKitStandard', 'glob': 'Exports/glTF/*.gltf', 'category': '奇幻道具', 'symbol': '⚔', 'color': '#a98b5c',
     'provenancePack': 'Quaternius Fantasy Props MegaKit'},
    {'code': 'SN', 'folder': 'Stylized_Nature_MegaKitStandard', 'glob': 'glTF/*.gltf', 'category': '自然植栽', 'symbol': '♣', 'color': '#6f9a5c',
     'provenancePack': 'Quaternius Stylized Nature MegaKit'},
    {'code': 'SF', 'folder': 'Modular SciFi MegaKit[Standard]', 'glob': 'glTF/**/*.gltf', 'category': '科幻模組', 'symbol': '⬡', 'color': '#6d8fa8',
     'provenancePack': 'Quaternius Modular SciFi MegaKit'},
    {'code': 'MV', 'folder': 'Medieval Village MegaKit[Standard]', 'glob': 'glTF/*.gltf', 'category': '中世紀村莊', 'symbol': '⌂', 'color': '#b08460',
     'provenancePack': 'Quaternius Medieval Village MegaKit'},
]

WORDS = {
    # shared
    'Small': '小', 'Medium': '中', 'Large': '大', 'Big': '大', 'Tall': '高', 'Short': '矮', 'Thin': '窄', 'Wide': '寬', 'Long': '長', 'Single': '單', 'Simple': '簡易', 'Round': '圓', 'Square': '方',
    'Half': '半', 'Corner': '轉角', 'Inner': '內', 'Outer': '外', 'Straight': '直', 'Curve': '弧', 'Curves': '弧', 'Center': '中', 'Mirror': '鏡像', 'Extension': '延伸', 'Open': '開', 'Closed': '關',
    'Empty': '空', 'Group': '組', 'Stack': '疊', 'Pile': '堆', 'Lid': '蓋', 'Triple': '三連', 'Stand': '架', 'Holder': '座', 'Broken': '破損', 'Divided': '分隔', 'Flat': '平', 'Hanging': '垂吊',
    'Dark': '深色', 'Light': '淺色', 'Wooden': '木', 'Wood': '木', 'Metal': '金屬', 'Metal2': '金屬2', 'Bronze': '青銅', 'Gold': '金', 'Plaster': '灰泥', 'Brick': '磚', 'Bricks': '磚', 'UnevenBrick': '亂磚',
    'UnevenBricks': '亂磚', 'RedBrick': '紅磚', 'WoodDark': '深木', 'WoodLight': '淺木', 'RoundTile': '圓瓦', 'RoundTiles': '圓瓦', 'Plastic': '塑膠', 'DarkMetal': '深色金屬', 'DarkMetal2': '深色金屬2',
    'DarkPlastic': '深色塑膠', 'DarkPlates': '深色板', 'WhitePlate2': '白板', 'MetalPlates': '金屬板', 'Plates': '板', 'Plate': '盤', 'Window': '窗', 'Windows': '窗', 'Door': '門', 'Frame': '框',
    'Wall': '牆', 'Floor': '地板', 'Roof': '屋頂', 'Stairs': '樓梯', 'Stair': '樓梯', 'Balcony': '陽台', 'Prop': '道具', 'Props': '道具', 'Rope': '繩', 'Rail': '欄杆', 'Rails': '欄杆', 'Ramp': '斜坡',
    'Platform': '平台', 'Column': '柱', 'Pipes': '管線', 'Pipe': '管', 'Vent': '通風口', 'Light2': '燈', 'Cable': '電纜', 'Cables': '電纜', 'Top': '頂部', 'Bottom': '底部', 'Band': '條帶', 'Band2': '條帶2',
    'Accent': '點綴', 'AccentStrip': '飾條', 'Triangles': '三角紋', 'Decal': '貼花', 'Logo': '標誌', 'Letters': '字母', 'Sign': '標示', 'Line': '線', 'Bend1': '彎1', 'Bend2': '彎2', 'L': '左', 'R': '右',
    'Cap': '端蓋', 'A': 'A', 'B': 'B', 'Astra': '星艦', 'Hollow': '中空', 'MetalSupport': '金屬支柱', 'Dashes': '虛線', 'XSign': '叉號標示',
    # fantasy props
    'Anvil': '鐵砧', 'Log': '原木', 'Axe': '斧頭', 'Bag': '袋子', 'Banner': '旗幟', 'Cloth': '布', 'Barrel': '木桶', 'Apples': '蘋果', 'Apple': '蘋果', 'Bed': '床', 'Twin1': '單人1', 'Twin2': '單人2',
    'Bench': '長凳', 'BookGroup': '書堆', 'BookStand': '書架', 'Book': '書', 'Simplified': '簡化', 'Bookcase': '書櫃', 'Bottle': '瓶子', 'Bottles': '瓶子', 'SmallBottle': '小瓶', 'SmallBottles': '小瓶組',
    'Bucket': '水桶', 'Cabinet': '櫃子', 'Cage': '籠子', 'CandleStick': '燭台', 'Candle': '蠟燭', 'Carrot': '胡蘿蔔', 'Cauldron': '大鍋', 'Chain': '鐵鍊', 'Coil': '捲', 'Chair': '椅子', 'Chalice': '聖杯',
    'Chandelier': '吊燈', 'Chest': '寶箱', 'Coin': '金幣', 'Crate': '板條箱', 'Dummy': '訓練假人', 'FarmCrate': '農作箱', 'Key': '鑰匙', 'Lantern': '提燈', 'Mug': '馬克杯', 'Nightstand': '床頭櫃',
    'Shelf': '架子', 'Peg': '掛鉤', 'Rack': '架', 'Pickaxe': '鶴嘴鋤', 'Pot': '鍋', 'Potion': '藥水', 'Pouch': '小袋', 'Scroll': '捲軸', 'Arch': '拱形', 'Shield': '盾牌', 'Stall': '攤位', 'Cart': '推車',
    'Stool': '凳子', 'Sword': '劍', 'Table': '桌', 'Fork': '叉', 'Knife': '刀', 'Spoon': '湯匙', 'Torch': '火把', 'Vase': '花瓶', 'Rubble': '碎石', 'WeaponStand': '武器架', 'Whetstone': '磨刀石',
    'Workbench': '工作台', 'Drawers': '抽屜',
    # nature
    'Bush': '灌木', 'Common': '常見', 'Flowers': '花', 'Flower': '花', 'Clover': '三葉草', 'CommonTree': '樹', 'DeadTree': '枯樹', 'Fern': '蕨', 'Grass': '草', 'Wispy': '纖細', 'Mushroom': '蘑菇',
    'Laetiporus': '硫磺菌', 'Pebble': '小卵石', 'Petal': '花瓣', 'Pine': '松樹', 'Plant': '植物', 'RockPath': '步道石', 'Rock': '岩石', 'TwistedTree': '扭曲樹', 'Tree': '樹',
    # scifi
    'Alien': '外星生物', 'Cyclop': '獨眼', 'Oculichrysalis': '眼蛹', 'Scolitex': '蟲型', 'Pipes2': '管線', 'AccessPoint': '存取點', 'Computer': '電腦', 'Fan': '風扇', 'ItemHolder': '物品架',
    'PipeHolder': '管線架', 'Clamp': '夾具', 'Incline': '斜', 'Hole': '孔', 'Padded': '軟墊',
    # medieval
    'Exterior': '外', 'Interior': '內', 'TopDown': '俯視', 'TopOnly': '僅頂', 'ExteriorWide': '寬外', 'DoorFrame': '門框', 'HoleCover': '洞口蓋', 'Overhang': '懸挑', 'Side': '側', 'Front': '前',
    'Chimney': '煙囪', 'Chimney2': '煙囪2', 'ExteriorBorder': '外緣', 'MetalFence': '鐵欄杆', 'WoodenFence': '木柵欄', 'Ornament': '裝飾', 'Support': '支撐', 'Vine': '藤蔓', 'Wagon': '馬車',
    'Dormer': '老虎窗', 'Modular': '模組', 'Tower': '塔', 'Tile': '瓦', 'Tiles': '瓦', 'Center2': '中央', 'Solid': '實心', 'Extended': '加長', 'NoFirstStep': '無首階', 'Sides': '雙側', 'SingleSide': '單側',
    'Thick': '厚', 'SidePlatform': '側平台', 'Clean': '乾淨', 'U': 'U形', 'Cover': '覆蓋', 'Base': '基座', 'Inset': '內凹', 'WoodGrid': '木格', 'Shutters': '百葉窗', 'Gradient': '漸層',
    'Middle': '中段', 'Angle': '轉角', 'Blocked': '封閉', 'Centre': '中央', 'Squares': '方塊', '3Plates': '三片板', 'CenterPlate': '中央板', 'SquareTall': '方形高', 'Wide': '寬', 'WideTall': '寬高', 'Bottom': '底部', 'Top': '頂部', 'BottomMetal': '底部金屬', 'BottomSimple': '底部簡易', 'TopAstra': '頂部星艦', 'TopCables': '頂部電纜', 'TopPlastic': '頂部塑膠', 'TopSimple': '頂部簡易', 'TopWindow': '頂部窗', 'ShortWall': '矮牆', 'WallAstra': '星艦牆', 'WallBand': '條帶牆', 'WallWindow': '窗牆', 'Cross': '十字', 'Simple1': '簡易1', 'Simple2': '簡易2', 'Round1': '圓1', 'Light2': '燈', 'Plastic': '塑膠', 'Metal': '金屬', 'Cap': '端蓋', 'DarkMetal': '深色金屬', 'WhitePlate': '白板', 'Wide2': '寬', 'Logs': '原木', 'FrontSupports': '前支撐', 'Roof2': '屋頂',
}

# Hand-written names for the two organic packs (token composition reads badly for "Axe_Bronze" or "CommonTree_1").
EXPLICIT = {
    'FP': {
        'Anvil': '鐵砧', 'Anvil_Log': '鐵砧（附木樁）', 'Axe_Bronze': '青銅斧', 'Bag': '布袋', 'Banner_1': '旗幟（紅，附橫桿）', 'Banner_1_Cloth': '旗幟布（紅）', 'Banner_2': '旗幟（藍，附橫桿）',
        'Banner_2_Cloth': '旗幟布（藍）', 'Barrel': '木桶', 'Barrel_Apples': '蘋果木桶', 'Barrel_Holder': '木桶架', 'Bed_Twin1': '單人床（藍綠）', 'Bed_Twin2': '單人床（綠）', 'Bench': '長凳',
        'BookGroup_Medium_1': '書堆（中）1', 'BookGroup_Medium_2': '書堆（中）2', 'BookGroup_Medium_3': '書堆（中）3', 'BookGroup_Small_1': '書堆（小）1', 'BookGroup_Small_2': '書堆（小）2',
        'BookGroup_Small_3': '書堆（小）3', 'BookStand': '書架台', 'Book_5': '書 5', 'Book_7': '書 7', 'Book_Simplified_Single': '書（簡化單本）', 'Book_Stack_1': '疊書 1', 'Book_Stack_2': '疊書 2',
        'Bookcase_2': '書櫃', 'Bottle_1': '酒瓶', 'Bucket_Metal': '鐵桶', 'Bucket_Wooden_1': '木桶（水桶）', 'Cabinet': '矮櫃', 'Cage_Small': '小鐵籠', 'CandleStick': '燭台', 'CandleStick_Stand': '落地燭台',
        'CandleStick_Triple': '三連燭台', 'Candle_1': '蠟燭 1', 'Candle_2': '蠟燭 2', 'Carrot': '胡蘿蔔', 'Cauldron': '大鍋', 'Chain_Coil': '鐵鍊圈', 'Chair_1': '木椅', 'Chalice': '聖杯',
        'Chandelier': '吊燈', 'Chest_Wood': '木寶箱', 'Coin': '金幣', 'Coin_Pile': '金幣堆', 'Coin_Pile_2': '金幣堆 2', 'Crate_Metal': '金屬箱', 'Crate_Wooden': '木箱', 'Dummy': '訓練假人',
        'FarmCrate_Apple': '蘋果農作箱', 'FarmCrate_Carrot': '胡蘿蔔農作箱', 'FarmCrate_Empty': '空農作箱', 'Key_Gold': '金鑰匙', 'Key_Metal': '鐵鑰匙', 'Lantern_Wall': '壁掛提燈', 'Mug': '馬克杯',
        'Nightstand_Shelf': '床頭櫃', 'Peg_Rack': '掛鉤架', 'Pickaxe_Bronze': '青銅鶴嘴鋤', 'Pot_1': '鍋子', 'Pot_1_Lid': '鍋蓋', 'Potion_1': '藥水 1', 'Potion_2': '藥水 2', 'Potion_4': '藥水 4',
        'Pouch_Large': '大錢袋', 'Rope_1': '繩索 1', 'Rope_2': '繩索 2', 'Rope_3': '繩索 3', 'Scroll_1': '捲軸 1', 'Scroll_2': '捲軸 2', 'Shelf_Arch': '拱形架', 'Shelf_Simple': '簡易層架',
        'Shelf_Small_Bottles': '小瓶層架', 'Shield_Wooden': '木盾', 'SmallBottle': '小瓶子', 'SmallBottles_1': '小瓶組', 'Stall_Cart_Empty': '空攤車', 'Stall_Empty': '空攤位', 'Stool': '圓凳',
        'Sword_Bronze': '青銅劍', 'Table_Fork': '叉子', 'Table_Knife': '餐刀', 'Table_Large': '大桌', 'Table_Plate': '盤子', 'Table_Spoon': '湯匙', 'Torch_Metal': '金屬火把', 'Vase_2': '花瓶 2',
        'Vase_4': '花瓶 4', 'Vase_Rubble_Medium': '破損花瓶', 'WeaponStand': '武器架', 'Whetstone': '磨刀石', 'Workbench': '工作台', 'Workbench_Drawers': '附抽屜工作台',
    },
    'SN': {
        'Bush_Common': '灌木', 'Bush_Common_Flowers': '開花灌木', 'Clover_1': '三葉草 1', 'Clover_2': '三葉草 2', 'Fern_1': '蕨', 'Flower_3_Group': '花叢 3', 'Flower_3_Single': '單朵花 3',
        'Flower_4_Group': '花叢 4', 'Flower_4_Single': '單朵花 4', 'Grass_Common_Short': '矮草', 'Grass_Common_Tall': '高草', 'Grass_Wispy_Short': '矮細草', 'Grass_Wispy_Tall': '高細草',
        'Mushroom_Common': '蘑菇', 'Mushroom_Laetiporus': '硫磺菌', 'Plant_1': '植物 1', 'Plant_1_Big': '大植物 1', 'Plant_7': '植物 7', 'Plant_7_Big': '大植物 7',
        'RockPath_Round_Thin': '圓步道石（窄）', 'RockPath_Round_Wide': '圓步道石（寬）', 'RockPath_Square_Thin': '方步道石（窄）', 'RockPath_Square_Wide': '方步道石（寬）',
    },
}
for _i in range(1, 6):
    EXPLICIT['SN'].update({f'CommonTree_{_i}': f'樹 {_i}', f'DeadTree_{_i}': f'枯樹 {_i}', f'Pine_{_i}': f'松樹 {_i}', f'TwistedTree_{_i}': f'扭曲樹 {_i}', f'Pebble_Round_{_i}': f'圓卵石 {_i}',
                           f'Pebble_Square_{_i}': f'方卵石 {_i}', f'Petal_{_i}': f'花瓣 {_i}'})
EXPLICIT['SN']['Pebble_Square_6'] = '方卵石 6'
for _i in range(1, 4):
    EXPLICIT['SN'].update({f'RockPath_Round_Small_{_i}': f'圓步道石（小）{_i}', f'RockPath_Square_Small_{_i}': f'方步道石（小）{_i}', f'Rock_Medium_{_i}': f'岩石（中）{_i}'})

SKIP_DIGITS = re.compile(r'^\d+$')
SIZE = re.compile(r'^(\d+)x(\d+)$')

NATURE_CATEGORY = [('自然植栽', ('Tree', 'Pine')), ('自然植栽', ('Bush', 'Fern', 'Plant', 'Clover', 'Grass', 'Flower', 'Petal')), ('自然植栽', ('Mushroom',)), ('自然岩石', ('Rock', 'Pebble'))]
SCIFI_FOLDERS = {'Aliens': '科幻外星生物', 'Columns': '科幻柱體', 'Decals': '科幻貼花', 'Platforms': '科幻平台', 'Props': '科幻道具', 'Walls': '科幻牆面'}
MEDIEVAL_PREFIXES = [('Balcony', '中世紀陽台'), ('Door', '中世紀門窗'), ('Window', '中世紀門窗'), ('Floor', '中世紀地板'), ('Roof', '中世紀屋頂'), ('Overhang', '中世紀屋頂'), ('Stair', '中世紀樓梯'),
                     ('Wall', '中世紀牆面'), ('Corner', '中世紀牆面'), ('HoleCover', '中世紀樓梯'), ('Prop', '中世紀道具')]


def tokens(stem):
    out = []
    for part in stem.split('_'):
        out.append(part)
    return out


def translate(parts):
    names, i = [], 0
    while i < len(parts):
        part = parts[i]
        pair = part + parts[i + 1] if i + 1 < len(parts) else None
        if SIZE.match(part):
            names.append(part.replace('x', '×'))
        elif SKIP_DIGITS.match(part):
            names.append(part)
        elif part in WORDS:
            names.append(WORDS[part])
        else:
            m = re.match(r'^([A-Za-z]+?)(\d+)$', part)
            if m and m.group(1) in WORDS:
                names.append(WORDS[m.group(1)] + m.group(2))
            else:
                m = re.match(r'^(\d+)([A-Za-z]+)$', part)  # 4Wide, 2Short
                sub = re.findall(r'[A-Z][a-z]+|\d+|[A-Z]+(?![a-z])', part)
                if m and m.group(2) in WORDS:
                    names.append(m.group(1) + WORDS[m.group(2)])
                elif len(sub) > 1 and all(w in WORDS or w.isdigit() for w in sub):
                    names.append(''.join(WORDS.get(w, w) for w in sub))
                else:
                    names.append(part)
        i += 1
    return names


def display_name(code, source, stem):
    if code in EXPLICIT:
        return EXPLICIT[code][stem]  # KeyError on purpose: a new file in the pack needs a reviewed name
    return '・'.join(translate(tokens(stem)))


def category_for(code, source, stem, default):
    if code == 'SN':
        for category, prefixes in NATURE_CATEGORY:
            if stem.startswith(prefixes) or any(p in stem for p in prefixes if p in ('Tree', 'Pine')):
                return category
        return default
    if code == 'SF':
        return SCIFI_FOLDERS.get(source.parent.name, default)
    if code == 'MV':
        for prefix, category in MEDIEVAL_PREFIXES:
            if stem.startswith(prefix):
                return category
    return default
