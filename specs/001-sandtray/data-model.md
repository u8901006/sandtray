## A5. 資料契約

```ts
type Action = 'translate' | 'rotate' | 'scale' | 'animate';
type Transform = {
  position: [number, number, number];
  rotation: [number, number, number, number]; // normalized quaternion x,y,z,w
  scale: number; // uniform, positive
};
interface SceneObject {
  id: string;
  assetId: string;
  assetVersion: string;
  label?: string; // <=80 characters
  transform: Transform;
  materialOverrides: Record<string, string>; // allowlisted slot -> hex color
  hidden: boolean;
  revision: number;
  animation?: {
    clipId: string; state: 'playing' | 'paused' | 'stopped';
    serverStartedAt: number; offsetMs: number;
    speed: number; loop: boolean; initiatedBy: string;
    path?: { points: [number, number, number][]; durationMs: number };
  };
}
interface SceneDocument {
  schemaVersion: 1;
  sceneId: string;
  sceneRevision: number;
  objects: SceneObject[];
  environment: { sandColor: string; backgroundColor: string };
  updatedAt: number;
}
interface TransformCommit {
  protocolVersion: 1;
  type: 'object.transform.commit';
  operationId: string;
  sessionEpoch: number;
  controlEpoch: number;
  objectId: string;
  expectedObjectRevision: number;
  leaseId: string;
  fencingToken: number;
  grantId?: string; // therapist only
  grantVersion?: number;
  transform: Transform;
}
```

伺服器從經驗證連線取得 participantId / clinicId / role；payload 不得決定這些值。JSON schema / Zod 驗證所有邊界：finite numbers、正規化 quaternion、允許範圍、資產白名單、字串長度。拒絕 NaN／Infinity／負 scale／未知動畫／任意資產網址。時間用 UTC epoch milliseconds。

| 儲存區 | 資料表／內容 | 主要約束 |
|---|---|---|
| D1 | clinics, therapists, assignments, scenes_index, rooms_index, login_sessions | 查詢必帶 clinicId；場景再查 therapist 指派 |
| Room SQLite | room_meta, participants, invites, grants, leases | 單房單一案主與治療師；邀請僅存 hash |
| Room SQLite | scene_objects, scene_meta, committed_events, operation_results, outbox | transaction 更新狀態、seq、去重結果 |
| R2 assets | catalog、GLB、貼圖、縮圖、license manifests | assetId + immutable version + content hash |
| R2 private | scene snapshot、命名版本、選擇保存的 PNG | clinicId/sceneId/versionId；只經授權 API 存取 |

sceneId 為長期作品，roomId 為本次互動。MVP 一份 scene 同時只允許一個可寫 room，由唯一 scene coordinator（可用獨立 DO）分配 active room，不能只靠最終一致的索引避免雙開。其他請求顯示作品使用中。scene coordinator 只管理寫入席位與版本指向，實際互動仍由 Room DO 負責。


## 2026-09-23 REQ-019 增量

`SceneObject` 新增向後相容欄位 `colorVariant?: 't1'|'t2'|'t3'|'t4'|'t5'|'t6'|'orig'`。缺欄的舊 snapshot 仍合法；對支援素材，產品語意為預設 `t2`，不是原作黑色。`object.appearance.commit` 可攜帶此欄位，server 只接受 catalog allow-list 的 assetId+assetVersion，並以案主身分、session/control epoch、expectedObjectRevision 與 durable operation receipt fencing。變體與 materialOverrides、hidden 同步進 scene history，restore 再驗證白名單。
