"""Selection, Traditional Chinese names, shelf categories and display sizes for bits-v1 (2026-10-10, Claude Opus 5.5).

User instruction 2026-10-10: import the 104 pieces recommended in docs/evidence/2026-10-10/opus/kaykit-bits5-candidates.html
from five KayKit "Bits" packs by Kay Lousberg in ./asset-packs. What the catalogue lacked: everyday cars and modern
apartment blocks, food of any kind, festive objects, and abstract people (meeples / pawns) for clients who do not want to
place a realistic figure. Left out: modular kitchen walls / counters / floors, chopped / raw / trash food variants, terrain
cubes and tunnels, printed character cards and tiles (flat images), and colour duplicates (one colour kept per shape,
except the four-colour meeples / pawns / flags, whose colours are what tells one person or side from another).
The kitchen knife is deliberately not imported; the therapist decides later whether it belongs on the shelf.

Licences: City / Restaurant / Space Base / Board Game ship License.txt (CC0). The Holiday Bits FREE folder has no licence
file; its itch.io page (https://kaylousberg.itch.io/holiday-bits, checked 2026-10-10) lists "Asset license: Creative Commons
Zero v1.0 Universal". That statement is saved as HOL-LICENSE.txt (HOLIDAY_LICENSE below) and marked as a page snapshot,
not a copy of a file from the pack.

displaySize = longest edge in tray units (1 unit = 7.2 cm). Within a pack, pieces that are used together keep their
relative scale (train on its tracks, apartments on their road tiles); hand-held things sit at 0.6–0.9, never below 0.6.
"""

PACKS = {
    'CTY': {'folder': 'KayKit_City_Builder_Bits_1.0_FREE', 'license': 'License.txt', 'provenancePack': 'KayKit City Builder Bits'},
    'RST': {'folder': 'KayKit_Restaurant_Bits_1.0_FREE', 'license': 'License.txt', 'provenancePack': 'KayKit Restaurant Bits'},
    'SPC': {'folder': 'KayKit_Space_Base_Bits_1.0_FREE', 'license': 'License.txt', 'provenancePack': 'KayKit Space Base Bits'},
    'BRD': {'folder': 'KayKit_BoardGameBits_1.0_FREE', 'license': 'License.txt', 'provenancePack': 'KayKit Board Game Bits'},
    'HOL': {'folder': 'KayKit_Holiday_Bits_1.0_FREE', 'license': None, 'provenancePack': 'KayKit Holiday Bits'},
}

HOLIDAY_LICENSE = """KayKit : Holiday Bits (1.0) FREE - licence snapshot

The FREE download of this pack contains no License.txt. This file is NOT part of the pack; it records the licence the
author publishes on the pack's page, as read on 2026-10-10 (Asia/Taipei) by Claude Opus 5.5 for the sandtray project.

Source: https://kaylousberg.itch.io/holiday-bits
"More information" table, field "Asset license": Creative Commons Zero v1.0 Universal
Page text: "These are completely free to use in any project of your choosing (yes, also commercially)."
Licence: http://creativecommons.org/publicdomain/zero/1.0/
Created/distributed by Kay Lousberg (www.kaylousberg.com). Credit is optional.
"""

APARTMENT, STREET, TRANSPORT, FOOD, KITCHEN, FESTIVE, SPACE, BOARD = '城市建築', '街道', '交通', '食物', '廚房', '節慶', '太空基地', '桌遊'
CATEGORY_LOOK = {APARTMENT: ('▥', '#b0675a'), STREET: ('⚑', '#7d8a96'), TRANSPORT: ('⛟', '#c99a2e'), FOOD: ('●', '#d0743c'),
                 KITCHEN: ('▣', '#5aa58f'), FESTIVE: ('✦', '#c0473f'), SPACE: ('◎', '#d98a3d'), BOARD: ('♟', '#5b7fc4')}

G = 'Assets/gltf/'
ITEMS = [
    # City Builder: whole blocks with their pavement base (the *_withoutBase twins are duplicates), sized with the road tiles.
    ('CTY', G + 'building_A.gltf', 'building_A', '藍色店面公寓', APARTMENT, 2.1),
    ('CTY', G + 'building_B.gltf', 'building_B', '橘藍雙層公寓', APARTMENT, 2.1),
    ('CTY', G + 'building_C.gltf', 'building_C', '紅色高公寓', APARTMENT, 3.1),
    ('CTY', G + 'building_D.gltf', 'building_D', '綠色高公寓', APARTMENT, 3.1),
    ('CTY', G + 'building_E.gltf', 'building_E', '遮陽篷公寓', APARTMENT, 2.5),
    ('CTY', G + 'building_F.gltf', 'building_F', '紅黃公寓', APARTMENT, 2.5),
    ('CTY', G + 'building_G.gltf', 'building_G', '綠棕店面大樓', APARTMENT, 3.1),
    ('CTY', G + 'building_H.gltf', 'building_H', '藍色大樓', APARTMENT, 3.2),
    ('CTY', G + 'car_police.gltf', 'car_police', '警車', TRANSPORT, 1.2),
    ('CTY', G + 'car_taxi.gltf', 'car_taxi', '計程車', TRANSPORT, 1.2),
    ('CTY', G + 'car_sedan.gltf', 'car_sedan', '轎車', TRANSPORT, 1.2),
    ('CTY', G + 'car_hatchback.gltf', 'car_hatchback', '小汽車', TRANSPORT, 1.1),
    ('CTY', G + 'car_stationwagon.gltf', 'car_stationwagon', '旅行車', TRANSPORT, 1.2),
    ('CTY', G + 'streetlight.gltf', 'streetlight', '路燈', STREET, 1.4),
    ('CTY', G + 'trafficlight_A.gltf', 'trafficlight', '紅綠燈', STREET, 1.2),
    ('CTY', G + 'firehydrant.gltf', 'firehydrant', '消防栓', STREET, 0.6),
    ('CTY', G + 'bench.gltf', 'bench', '公園長椅', STREET, 0.8),
    ('CTY', G + 'dumpster.gltf', 'dumpster', '大型垃圾箱', STREET, 0.9),
    ('CTY', G + 'trash_A.gltf', 'trash', '垃圾袋', STREET, 0.6),
    ('CTY', G + 'watertower.gltf', 'watertower', '屋頂水塔', STREET, 1.0),
    ('CTY', G + 'bush.gltf', 'bush', '行道樹叢', STREET, 0.7),
    ('CTY', G + 'box_A.gltf', 'box', '紙箱', STREET, 0.6),
    ('CTY', G + 'road_straight.gltf', 'road_straight', '直路', STREET, 2.1),
    ('CTY', G + 'road_straight_crossing.gltf', 'road_crossing', '斑馬線', STREET, 2.1),
    ('CTY', G + 'road_corner_curved.gltf', 'road_curve', '彎道', STREET, 2.1),
    ('CTY', G + 'road_junction.gltf', 'road_junction', '十字路口', STREET, 2.1),
    # Restaurant: whole dishes and whole ingredients, a few kitchen appliances and dishes, one laid table, two market crates.
    ('RST', G + 'food_burger.gltf', 'burger', '漢堡', FOOD, 0.7),
    ('RST', G + 'food_dinner.gltf', 'dinner', '一盤晚餐', FOOD, 0.8),
    ('RST', G + 'stew_bowl.gltf', 'stew_bowl', '一碗燉菜', FOOD, 0.6),
    ('RST', G + 'food_ingredient_carrot.gltf', 'carrot', '紅蘿蔔', FOOD, 0.7),
    ('RST', G + 'food_ingredient_tomato.gltf', 'tomato', '番茄', FOOD, 0.6),
    ('RST', G + 'food_ingredient_cheese.gltf', 'cheese', '起司', FOOD, 0.6),
    ('RST', G + 'food_ingredient_lettuce.gltf', 'lettuce', '萵苣', FOOD, 0.7),
    ('RST', G + 'food_ingredient_onion.gltf', 'onion', '洋蔥', FOOD, 0.6),
    ('RST', G + 'food_ingredient_potato.gltf', 'potato', '馬鈴薯', FOOD, 0.6),
    ('RST', G + 'food_ingredient_steak.gltf', 'steak', '牛排', FOOD, 0.7),
    ('RST', G + 'food_ingredient_ham_cooked.gltf', 'ham', '烤雞腿', FOOD, 0.8),
    ('RST', G + 'fridge_A.gltf', 'fridge', '綠色冰箱', KITCHEN, 2.0),
    ('RST', G + 'stove_single.gltf', 'stove', '瓦斯爐', KITCHEN, 1.6),
    ('RST', G + 'oven.gltf', 'oven', '烤箱', KITCHEN, 1.6),
    ('RST', G + 'plate.gltf', 'plate', '白盤子', KITCHEN, 0.6),
    ('RST', G + 'bowl.gltf', 'bowl', '白碗', KITCHEN, 0.6),
    ('RST', G + 'pot_A_stew.gltf', 'pot_stew', '一鍋燉菜', KITCHEN, 0.8),
    ('RST', G + 'pan_A.gltf', 'pan', '平底鍋', KITCHEN, 0.8),
    ('RST', G + 'ketchup.gltf', 'ketchup', '番茄醬', KITCHEN, 0.6),
    ('RST', G + 'jar_A_medium.gltf', 'jar', '調味罐', KITCHEN, 0.6),
    ('RST', G + 'table_round_A_decorated.gltf', 'table_laid', '擺滿菜的圓桌', KITCHEN, 2.2),
    ('RST', G + 'crate_carrots.gltf', 'crate_carrots', '一箱紅蘿蔔', FOOD, 1.2),
    ('RST', G + 'crate_tomatoes.gltf', 'crate_tomatoes', '一箱番茄', FOOD, 1.2),
    # Space Base: whole buildings and vehicles only (terrain cubes, tunnels, roof add-ons left out).
    ('SPC', G + 'basemodule_A.gltf', 'basemodule_A', '太空基地艙', SPACE, 2.6),
    ('SPC', G + 'basemodule_E.gltf', 'basemodule_dome', '圓頂基地艙', SPACE, 2.6),
    ('SPC', G + 'basemodule_garage.gltf', 'garage', '太空車庫', SPACE, 2.6),
    ('SPC', G + 'lander_A.gltf', 'lander_A', '登陸艇', SPACE, 1.6),
    ('SPC', G + 'lander_B.gltf', 'lander_B', '圓頂登陸艇', SPACE, 1.6),
    ('SPC', G + 'drill_structure.gltf', 'drill', '鑽井架', SPACE, 2.2),
    ('SPC', G + 'windturbine_tall.gltf', 'windturbine', '風力發電機', SPACE, 3.0),
    ('SPC', G + 'landingpad_small.gltf', 'landingpad', '降落平台', SPACE, 2.2),
    ('SPC', G + 'spacetruck.gltf', 'spacetruck', '太空車', SPACE, 1.0),
    ('SPC', G + 'solarpanel.gltf', 'solarpanel', '太陽能板', SPACE, 1.0),
    ('SPC', G + 'cargo_A_stacked.gltf', 'cargo', '一疊貨櫃', SPACE, 1.0),
    ('SPC', G + 'rocks_B.gltf', 'rocks', '火星岩石堆', SPACE, 1.8),
    ('SPC', G + 'rock_B.gltf', 'rock', '火星岩石', SPACE, 0.8),
    # Board Game: four colours of meeple / pawn / flag (colour = which person or side), plus dice, hourglasses, a house, a domino.
    ('BRD', G + 'meeple_red.gltf', 'meeple_red', '紅色小人', BOARD, 0.8),
    ('BRD', G + 'meeple_blue.gltf', 'meeple_blue', '藍色小人', BOARD, 0.8),
    ('BRD', G + 'meeple_green.gltf', 'meeple_green', '綠色小人', BOARD, 0.8),
    ('BRD', G + 'meeple_yellow.gltf', 'meeple_yellow', '黃色小人', BOARD, 0.8),
    ('BRD', G + 'pawn_A_red.gltf', 'pawn_red', '紅色棋子', BOARD, 0.7),
    ('BRD', G + 'pawn_A_blue.gltf', 'pawn_blue', '藍色棋子', BOARD, 0.7),
    ('BRD', G + 'pawn_A_green.gltf', 'pawn_green', '綠色棋子', BOARD, 0.7),
    ('BRD', G + 'pawn_A_yellow.gltf', 'pawn_yellow', '黃色棋子', BOARD, 0.7),
    ('BRD', G + 'flag_A_red.gltf', 'flag_red', '紅旗', BOARD, 1.0),
    ('BRD', G + 'flag_A_blue.gltf', 'flag_blue', '藍旗', BOARD, 1.0),
    ('BRD', G + 'flag_A_green.gltf', 'flag_green', '綠旗', BOARD, 1.0),
    ('BRD', G + 'flag_A_yellow.gltf', 'flag_yellow', '黃旗', BOARD, 1.0),
    ('BRD', G + 'D6_A.gltf', 'dice', '骰子', BOARD, 0.6),
    ('BRD', G + 'D20_red.gltf', 'dice_d20', '二十面骰', BOARD, 0.6),
    ('BRD', G + 'hourglass.gltf', 'hourglass', '沙漏', BOARD, 1.2),
    ('BRD', G + 'hourglass_empty.gltf', 'hourglass_empty', '空沙漏', BOARD, 1.2),
    ('BRD', G + 'building_red.gltf', 'house', '紅色房屋棋子', BOARD, 0.7),
    ('BRD', G + 'domino_tile_6-6.gltf', 'domino', '骨牌', BOARD, 0.8),
    # Holiday (licence from the itch.io page, see HOLIDAY_LICENSE). Train and tracks share one scale (×1.4) so they fit.
    ('HOL', G + 'snowman_A.gltf', 'snowman_A', '雪人', FESTIVE, 1.5),
    ('HOL', G + 'snowman_B.gltf', 'snowman_B', '戴帽子的雪人', FESTIVE, 1.9),
    ('HOL', G + 'wreath.gltf', 'wreath', '聖誕花圈', FESTIVE, 1.0),
    ('HOL', G + 'bell_decorated.gltf', 'bell', '鈴鐺', FESTIVE, 0.8),
    ('HOL', G + 'present_A_red.gltf', 'present_red', '紅色禮物', FESTIVE, 0.7),
    ('HOL', G + 'present_B_blue.gltf', 'present_blue', '藍色高禮物', FESTIVE, 0.9),
    ('HOL', G + 'present_C_yellow.gltf', 'present_yellow', '黃色扁禮物', FESTIVE, 0.7),
    ('HOL', G + 'present_sphere_A_green.gltf', 'present_round', '圓形禮物', FESTIVE, 0.7),
    ('HOL', G + 'basketball.gltf', 'basketball', '籃球', FESTIVE, 0.7),
    ('HOL', G + 'football.gltf', 'football', '足球', FESTIVE, 0.6),
    ('HOL', G + 'gingerbread_house_decorated.gltf', 'gingerbread_house', '薑餅屋', FESTIVE, 1.4),
    ('HOL', G + 'gingerbread_man.gltf', 'gingerbread_man', '薑餅人', FESTIVE, 0.6),
    ('HOL', G + 'hot_chocolate.gltf', 'hot_chocolate', '熱可可', FESTIVE, 0.6),
    ('HOL', G + 'cookie.gltf', 'cookie', '餅乾', FESTIVE, 0.6),
    ('HOL', G + 'milk.gltf', 'milk', '一杯牛奶', FESTIVE, 0.6),
    ('HOL', G + 'candycane_small.gltf', 'candycane', '拐杖糖', FESTIVE, 0.6),
    ('HOL', G + 'christmas_tree_decorated.gltf', 'tree_decorated', '裝飾好的聖誕樹', FESTIVE, 3.0),
    ('HOL', G + 'christmas_tree.gltf', 'tree', '聖誕樹', FESTIVE, 2.8),
    ('HOL', G + 'snowball_pile.gltf', 'snowball_pile', '一堆雪球', FESTIVE, 1.0),
    ('HOL', G + 'train_locomotive.gltf', 'train_locomotive', '小火車頭', TRANSPORT, 1.2),
    ('HOL', G + 'train_wagon.gltf', 'train_wagon', '小火車車廂', TRANSPORT, 1.4),
    ('HOL', G + 'train_tender_presents_A.gltf', 'train_presents', '載禮物的車廂', TRANSPORT, 1.0),
    ('HOL', G + 'tracks_straight.gltf', 'tracks_straight', '直鐵軌', TRANSPORT, 1.4),
    ('HOL', G + 'tracks_curve.gltf', 'tracks_curve', '彎鐵軌', TRANSPORT, 3.1),
]
