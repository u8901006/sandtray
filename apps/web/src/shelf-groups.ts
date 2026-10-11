// 2026-10-09 UX 建議 2（Claude Opus 5.5）：物件架先選大類，再選細分類。資料的 category 不變，只在畫面上分組。
// 未列入任何大類的分類一律落在「其他」，新匯入的素材不會因為沒被分組而看不到。
export type ShelfGroup={id:string;label:string;glyph:string;categories:readonly string[]};
export const SHELF_GROUPS:readonly ShelfGroup[]=[
 {id:'people',label:'人物',glyph:'人',categories:['人物','角色與動物','奇幻人物','練習']},
 {id:'animals',label:'動物',glyph:'獸',categories:['動物']},
 {id:'buildings',label:'建築',glyph:'屋',categories:['建築','台灣地標','城市建築','街道','城堡村莊','廢墟遺跡','中世紀牆面','中世紀門窗','中世紀屋頂','中世紀地板','中世紀樓梯','中世紀陽台']},
 {id:'nature',label:'自然',glyph:'樹',categories:['自然','自然植栽','自然岩石','山丘與雲']},
 {id:'transport',label:'交通',glyph:'車',categories:['交通']},
 {id:'fantasy',label:'奇幻神話',glyph:'幻',categories:['神話','奇幻道具','地城','骷髏','武器盾牌']},
 {id:'scifi',label:'科幻',glyph:'星',categories:['太空基地','科幻外星生物','科幻道具','科幻平台','科幻柱體','科幻牆面','科幻貼花']},
 {id:'daily',label:'日常',glyph:'物',categories:['家具','食物','廚房','節慶','探險工具','寶藏與材料','中世紀道具','競技場']},
 {id:'symbols',label:'象徵',glyph:'心',categories:['象徵','桌遊']},
];
export const OTHER_GROUP:ShelfGroup={id:'other',label:'其他',glyph:'…',categories:[]};
/** The shelf group a catalogue category is shown under. */
export function categoryGroup(category:string):ShelfGroup{return SHELF_GROUPS.find(g=>g.categories.includes(category))??OTHER_GROUP;}
/** Groups that have at least one of the given categories, in shelf order, each with its present categories in group order. */
export function shelfGroups(categories:Iterable<string>):{group:ShelfGroup;categories:string[]}[]{
 const present=new Set(categories),rows=[...SHELF_GROUPS,OTHER_GROUP].map(group=>({group,categories:group===OTHER_GROUP?[...present].filter(c=>categoryGroup(c)===OTHER_GROUP):group.categories.filter(c=>present.has(c))}));
 return rows.filter(row=>row.categories.length>0);
}
