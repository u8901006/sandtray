import type {Page} from '@playwright/test';
import {categoryGroup} from '../../apps/web/src/shelf-groups';
// 2026-10-09 UX 建議 2：細分類按鈕收在大類底下。先點大類（會重設成整類），再點細分類，與舊版「直接點分類」同一個結果。
export async function openCategory(page:Page,category:string){
 await page.getByRole('button',{name:categoryGroup(category).label+'類',exact:true}).click();
 await page.getByRole('button',{name:category,exact:true}).click();
}
