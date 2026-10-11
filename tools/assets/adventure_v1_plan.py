"""Selection, Traditional Chinese names, shelf categories and display sizes for adventure-v1 (2026-10-10, Claude Opus 5.5).

User instruction 2026-10-10: import the pieces recommended in docs/evidence/2026-10-10/opus/blendercity-candidates.html
from ./asset-packs (KayKit packs by Kay Lousberg + Quaternius Ultimate Modular Ruins; all CC0 1.0).
Only symbolically useful miniatures are taken: no hex floor tiles, no screws/pencils, one roof colour (blue) of the
four identical building variants, and no piece that duplicates an existing catalogue item (megakits chest, candles,
cart, barrel; Kenney beds/chairs/tables).
Dropped after the first thumbnail review: props/tent (actually a bare table), tree_single_A_cut (a tall trunk, not a
stump), hill_single_A (a flat hex floor tile), building_bridge_A/B (on their own they read as grey wall
slabs, not bridges), Ruins Chest_Gold (lid closed, so its 22k-triangle coin pile is invisible; megakits already has a chest).

displaySize = longest edge in tray units (1 unit = 7.2 cm, REQ-016 §2.0). Figures keep the catalogue-wide 1.6 so they
match every existing person; hand-held items are smaller and buildings / mountains larger, as in a physical sandtray
collection. Never below 0.6 (4.3 cm) so a piece stays easy to pick up on a phone.
"""

PACKS = {
    'ADV': {'folder': 'KayKit_Adventurers_2.0_FREE', 'license': 'License.txt', 'provenancePack': 'KayKit Adventurers', 'author': 'Kay Lousberg', 'anim': 'Animations/gltf/Rig_Medium'},
    'SKL': {'folder': 'KayKit_Skeletons_1.1_FREE', 'license': 'License.txt', 'provenancePack': 'KayKit Skeletons', 'author': 'Kay Lousberg', 'anim': 'Animations/gltf/Rig_Medium'},
    'HEX': {'folder': 'KayKit_Medieval_Hexagon_Pack_1.0_FREE', 'license': 'License.txt', 'provenancePack': 'KayKit Medieval Hexagon Pack', 'author': 'Kay Lousberg'},
    'WPN': {'folder': 'KayKit_FantasyWeaponsBits_1.0_FREE', 'license': 'License.txt', 'provenancePack': 'KayKit Fantasy Weapons Bits', 'author': 'Kay Lousberg'},
    'TLS': {'folder': 'KayKit_RPGToolsBits_1.0_FREE', 'license': 'License.txt', 'provenancePack': 'KayKit RPG Tools Bits', 'author': 'Kay Lousberg'},
    'RES': {'folder': 'KayKit_ResourceBits_1.0_FREE', 'license': 'License.txt', 'provenancePack': 'KayKit Resource Bits', 'author': 'Kay Lousberg'},
    'FUR': {'folder': 'KayKit_Furniture_Bits_1.0_FREE', 'license': 'License.txt', 'provenancePack': 'KayKit Furniture Bits', 'author': 'Kay Lousberg'},
    'RUN': {'folder': 'Ultimate Modular Ruins Pack - Aug 2021', 'license': 'License.txt', 'provenancePack': 'Quaternius Ultimate Modular Ruins', 'author': 'Quaternius'},
}

HERO, SKEL, TOWN, SKY, RUIN, WEAPON, TOOL, TREASURE, HOME = '奇幻人物', '骷髏', '城堡村莊', '山丘與雲', '廢墟遺跡', '武器盾牌', '探險工具', '寶藏與材料', '家具'
CATEGORY_LOOK = {HERO: ('♞', '#7c6fb0'), SKEL: ('☠', '#9a9488'), TOWN: ('♜', '#6a8fb8'), SKY: ('▲', '#7b9a6a'), RUIN: ('∩', '#9a927e'),
                 WEAPON: ('⚔', '#8a8f99'), TOOL: ('✧', '#b08a55'), TREASURE: ('◆', '#c9a34a'), HOME: ('⌂', '#b08460')}

# (pack, source path relative to the pack folder, id stem, name, category, displaySize)
H = 'Assets/gltf/buildings/blue/'
N = 'Assets/gltf/buildings/neutral/'
D = 'Assets/gltf/decoration/'
ITEMS = [
    # KayKit Adventurers: rigged figures get an idle default pose and three clips (see import_adventure_v1.py)
    ('ADV', 'Characters/gltf/Knight.glb', 'Knight', '騎士', HERO, 1.6),
    ('ADV', 'Characters/gltf/Barbarian.glb', 'Barbarian', '野蠻人', HERO, 1.6),
    ('ADV', 'Characters/gltf/Mage.glb', 'Mage', '法師', HERO, 1.6),
    ('ADV', 'Characters/gltf/Ranger.glb', 'Ranger', '遊俠', HERO, 1.6),
    ('ADV', 'Characters/gltf/Rogue.glb', 'Rogue', '盜賊', HERO, 1.6),
    ('ADV', 'Characters/gltf/Rogue_Hooded.glb', 'Rogue_Hooded', '戴兜帽的盜賊', HERO, 1.6),
    ('ADV', 'Assets/gltf/spellbook_open.gltf', 'spellbook_open', '打開的魔法書', TOOL, 0.7),
    ('ADV', 'Assets/gltf/mug_full.gltf', 'mug_full', '裝滿的木杯', TOOL, 0.6),
    # KayKit Skeletons
    ('SKL', 'characters/gltf/Skeleton_Warrior.glb', 'Skeleton_Warrior', '骷髏戰士', SKEL, 1.6),
    ('SKL', 'characters/gltf/Skeleton_Mage.glb', 'Skeleton_Mage', '骷髏法師', SKEL, 1.6),
    ('SKL', 'characters/gltf/Skeleton_Rogue.glb', 'Skeleton_Rogue', '骷髏盜賊', SKEL, 1.6),
    ('SKL', 'characters/gltf/Skeleton_Minion.glb', 'Skeleton_Minion', '骷髏小兵', SKEL, 1.4),
    ('SKL', 'assets/gltf/Skeleton_Arrow_Broken.gltf', 'Skeleton_Arrow_Broken', '斷箭', SKEL, 0.7),
    # KayKit Medieval Hexagon: whole buildings (blue roof only)
    ('HEX', H + 'building_castle_blue.gltf', 'castle', '城堡', TOWN, 3.2),
    ('HEX', H + 'building_church_blue.gltf', 'church', '教堂', TOWN, 2.6),
    ('HEX', H + 'building_windmill_blue.gltf', 'windmill', '風車', TOWN, 2.6),
    ('HEX', H + 'building_watermill_blue.gltf', 'watermill', '水車磨坊', TOWN, 2.4),
    ('HEX', H + 'building_tower_A_blue.gltf', 'tower_A', '瞭望塔', TOWN, 2.6),
    ('HEX', H + 'building_tower_B_blue.gltf', 'tower_B', '圓塔', TOWN, 2.6),
    ('HEX', H + 'building_home_A_blue.gltf', 'home_A', '小房子', TOWN, 2.0),
    ('HEX', H + 'building_home_B_blue.gltf', 'home_B', '兩層房子', TOWN, 2.2),
    ('HEX', H + 'building_tavern_blue.gltf', 'tavern', '酒館', TOWN, 2.4),
    ('HEX', H + 'building_market_blue.gltf', 'market', '市集攤位', TOWN, 2.0),
    ('HEX', H + 'building_well_blue.gltf', 'well', '水井', TOWN, 1.4),
    ('HEX', H + 'building_mine_blue.gltf', 'mine', '礦坑', TOWN, 2.4),
    ('HEX', H + 'building_blacksmith_blue.gltf', 'blacksmith', '鐵匠舖', TOWN, 2.2),
    ('HEX', H + 'building_lumbermill_blue.gltf', 'lumbermill', '伐木場', TOWN, 2.2),
    ('HEX', N + 'building_destroyed.gltf', 'destroyed', '倒塌的房子', TOWN, 2.0),
    ('HEX', N + 'fence_wood_straight.gltf', 'fence_wood', '木柵欄', TOWN, 1.6),
    ('HEX', N + 'fence_wood_straight_gate.gltf', 'fence_wood_gate', '木柵門', TOWN, 1.6),
    ('HEX', N + 'fence_stone_straight.gltf', 'fence_stone', '石牆矮籬', TOWN, 1.6),
    ('HEX', N + 'wall_straight.gltf', 'wall', '城牆', TOWN, 2.2),
    ('HEX', N + 'wall_straight_gate.gltf', 'wall_gate', '城門', TOWN, 2.2),
    ('HEX', D + 'props/wheelbarrow.gltf', 'wheelbarrow', '手推車', TOWN, 1.0),
    ('HEX', D + 'props/sack.gltf', 'sack', '麻布袋', TOWN, 0.6),
    ('HEX', D + 'props/ladder.gltf', 'ladder', '梯子', TOWN, 1.2),
    # KayKit Medieval Hexagon: mountains, hills, clouds, trees, water plants
    ('HEX', D + 'nature/mountain_A.gltf', 'mountain_A', '岩山 1', SKY, 3.0),
    ('HEX', D + 'nature/mountain_B.gltf', 'mountain_B', '岩山 2', SKY, 3.0),
    ('HEX', D + 'nature/mountain_C.gltf', 'mountain_C', '岩山 3', SKY, 3.0),
    ('HEX', D + 'nature/mountain_A_grass_trees.gltf', 'mountain_A_trees', '長樹的山', SKY, 3.0),
    ('HEX', D + 'nature/hills_A_trees.gltf', 'hills_A_trees', '有樹的丘陵', SKY, 2.6),
    ('HEX', D + 'nature/cloud_big.gltf', 'cloud_big', '大雲朵', SKY, 2.2),
    ('HEX', D + 'nature/cloud_small.gltf', 'cloud_small', '小雲朵', SKY, 1.4),
    ('HEX', D + 'nature/trees_A_large.gltf', 'trees_A_large', '樹林', SKY, 2.0),
    ('HEX', D + 'nature/trees_B_medium.gltf', 'trees_B_medium', '松樹林', SKY, 1.8),
    ('HEX', D + 'nature/tree_single_A.gltf', 'tree_A', '一棵樹', SKY, 1.6),
    ('HEX', D + 'nature/waterlily_A.gltf', 'waterlily', '睡蓮', SKY, 0.6),
    ('HEX', D + 'nature/waterplant_A.gltf', 'waterplant', '水草', SKY, 0.8),
    # Quaternius Ruins (FBX only; converted by build_ruins_v1.py). Chest, candles, barrel, cart already exist in megakits.
    ('RUN', 'FBX/Arch_Gothic.fbx', 'Arch_Gothic', '尖頂石拱門', RUIN, 2.4),
    ('RUN', 'FBX/Arch_Round.fbx', 'Arch_Round', '圓頂石拱門', RUIN, 2.4),
    ('RUN', 'FBX/Doors_RoundArch.fbx', 'Doors_RoundArch', '拱形木門', RUIN, 2.0),
    ('RUN', 'FBX/Wall_Broken.fbx', 'Wall_Broken', '斷牆', RUIN, 2.0),
    ('RUN', 'FBX/Wall_ArchRound_Overgrown_Broken.fbx', 'Wall_Arch_Overgrown', '長草的破拱牆', RUIN, 2.2),
    ('RUN', 'FBX/Window_Bars.fbx', 'Window_Bars', '鐵窗', RUIN, 1.6),
    ('RUN', 'FBX/Column_Round.fbx', 'Column_Round', '石柱', RUIN, 2.0),
    ('RUN', 'FBX/Statue_Fox.fbx', 'Statue_Fox', '狐狸石像', RUIN, 1.6),
    ('RUN', 'FBX/Statue_Stag.fbx', 'Statue_Stag', '鹿石像', RUIN, 1.8),
    ('RUN', 'FBX/Skull.fbx', 'Skull', '頭骨', SKEL, 0.6),
    ('RUN', 'FBX/DeadTree_1.fbx', 'DeadTree_1', '枯樹 1', RUIN, 2.0),
    ('RUN', 'FBX/DeadTree_2.fbx', 'DeadTree_2', '枯樹 2', RUIN, 2.0),
    ('RUN', 'FBX/DeadTree_3.fbx', 'DeadTree_3', '枯樹 3', RUIN, 2.0),
    ('RUN', 'FBX/BearTrap_Open.fbx', 'BearTrap_Open', '捕獸夾', RUIN, 0.7),
    ('RUN', 'FBX/Pot1_Broken.fbx', 'Pot1_Broken', '破陶罐', RUIN, 0.6),
    ('RUN', 'FBX/BridgeSection.fbx', 'BridgeSection', '石板平台', RUIN, 2.4),
    ('RUN', 'FBX/Stairs.fbx', 'Stairs', '石階', RUIN, 1.6),
    # KayKit Fantasy Weapons
    ('WPN', 'Assets/gltf/sword_A.gltf', 'sword', '劍', WEAPON, 1.0),
    ('WPN', 'Assets/gltf/shield_A.gltf', 'shield_A', '圓盾', WEAPON, 0.8),
    ('WPN', 'Assets/gltf/shield_B.gltf', 'shield_B', '鳶形盾', WEAPON, 0.8),
    ('WPN', 'Assets/gltf/shield_C.gltf', 'shield_C', '方盾', WEAPON, 0.8),
    ('WPN', 'Assets/gltf/bow_A_withString.gltf', 'bow', '弓', WEAPON, 1.0),
    ('WPN', 'Assets/gltf/axe_A.gltf', 'axe', '戰斧', WEAPON, 1.0),
    ('WPN', 'Assets/gltf/spear_A.gltf', 'spear', '長矛', WEAPON, 1.4),
    ('WPN', 'Assets/gltf/staff_A.gltf', 'staff', '法杖', WEAPON, 1.4),
    ('WPN', 'Assets/gltf/wand_A.gltf', 'wand', '魔杖', WEAPON, 0.7),
    # KayKit RPG Tools
    ('TLS', 'Assets/gltf/lantern.gltf', 'lantern', '燈籠', TOOL, 0.7),
    ('TLS', 'Assets/gltf/torch.gltf', 'torch', '火把', TOOL, 0.9),
    ('TLS', 'Assets/gltf/map.gltf', 'map', '攤開的地圖', TOOL, 0.8),
    ('TLS', 'Assets/gltf/map_rolled.gltf', 'map_rolled', '捲起的地圖', TOOL, 0.7),
    ('TLS', 'Assets/gltf/magnifying_glass.gltf', 'magnifying_glass', '放大鏡', TOOL, 0.6),
    ('TLS', 'Assets/gltf/journal_open.gltf', 'journal_open', '打開的日記', TOOL, 0.7),
    ('TLS', 'Assets/gltf/rope_bundle_A.gltf', 'rope', '一捆繩子', TOOL, 0.6),
    ('TLS', 'Assets/gltf/shovel.gltf', 'shovel', '鏟子', TOOL, 1.1),
    ('TLS', 'Assets/gltf/pickaxe.gltf', 'pickaxe', '十字鎬', TOOL, 1.0),
    ('TLS', 'Assets/gltf/compass_base.gltf', 'compass', '羅盤', TOOL, 0.6),
    # KayKit Resources
    ('RES', 'Assets/gltf/Gold_Nuggets.gltf', 'gold_nuggets', '金塊', TREASURE, 0.6),
    ('RES', 'Assets/gltf/Gold_Bars_Stack_Medium.gltf', 'gold_bars', '一疊金條', TREASURE, 0.8),
    ('RES', 'Assets/gltf/Silver_Nuggets.gltf', 'silver_nuggets', '銀塊', TREASURE, 0.6),
    ('RES', 'Assets/gltf/Wood_Log_Stack.gltf', 'wood_logs', '一堆木頭', TREASURE, 1.0),
    ('RES', 'Assets/gltf/Wood_Planks_Stack_Small.gltf', 'wood_planks', '一疊木板', TREASURE, 0.9),
    ('RES', 'Assets/gltf/Stone_Chunks_Large.gltf', 'stone_chunks', '石塊', TREASURE, 0.7),
    ('RES', 'Assets/gltf/Stone_Bricks_Stack_Small.gltf', 'stone_bricks', '一疊石磚', TREASURE, 0.8),
    ('RES', 'Assets/gltf/Textiles_Stack_Small.gltf', 'textiles', '一疊布匹', TREASURE, 0.7),
    # KayKit Furniture: only what the 140 Kenney pieces lack
    ('FUR', 'Assets/gltf/pictureframe_standing_A.gltf', 'frame_standing', '立式空白相框', HOME, 0.7),
    ('FUR', 'Assets/gltf/pictureframe_large_A.gltf', 'frame_large', '大空白相框', HOME, 1.0),
    ('FUR', 'Assets/gltf/rug_oval_A.gltf', 'rug_oval', '橢圓地毯', HOME, 1.6),
    ('FUR', 'Assets/gltf/rug_rectangle_stripes_A.gltf', 'rug_stripes', '條紋地毯', HOME, 1.8),
    ('FUR', 'Assets/gltf/cactus_medium_A.gltf', 'cactus_medium', '仙人掌盆栽', HOME, 0.8),
    ('FUR', 'Assets/gltf/cactus_small_B.gltf', 'cactus_small', '小仙人掌', HOME, 0.6),
]

# Clips merged into each rigged figure, from the pack's Rig_Medium animation files: (source file, animation, display name).
# The first clip's t=0 pose also becomes the figure's default (non-animated) pose, so nobody stands in a T-pose.
CLIPS = [('Rig_Medium_General.glb', 'Idle_A', '待機'), ('Rig_Medium_MovementBasic.glb', 'Walking_A', '行走'), ('Rig_Medium_General.glb', 'Death_A', '倒下')]
