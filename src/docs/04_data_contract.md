# 04 · 数据协议 v1

## 原始记录

每帧保存 `store_id / task_id / segment_id / frame_id / timestamp_s / image_path / width / height`。frame_id 在 task 内唯一；同一物理 store 的所有 task 不能跨 train/dev/test。路径相对 dataset root；不在仓库保存真实客户图片。

segment 表达连续采集片段，不把 0.5 秒采样间隔当作已知位移。遮挡、暂停和异地重启另有标签；只有时间连续不足以确认通行。

## 窗口记录

见 `examples/window_manifest.json`。核心字段：

| 字段 | 要求 |
|---|---|
| `schema_version` | 固定 `1.0` |
| `sample_id`、store/task/split | 明确所属数据与划分 |
| `frames` | metadata 列表；时间非递减；frame_id 唯一 |
| `context_frame_ids` | online 可访问帧；包含 anchor |
| `hidden_frame_ids` | 额外 target 帧；与 context 不相交 |
| `teacher_frame_ids` | 通常为 context + hidden；必须覆盖两者 |
| `anchor_frame_id` | 来源于 context |
| `query_cutoff_s` | 在线允许的最后时间；线上 observation 也不能超出 |
| `memory_snapshot` | committed_at ≤ snapshot_cutoff；不能包含本窗口帧证据 |
| `chart` | 坐标规范、span、有效性，不作为作弊 GT 输入 |
| `labels` | 路径、来源、mask 协议；不存在时为 null，不造标签 |

一个图条目的事实发生时间和写入时间分开：`observed_at_s` 与 `committed_at_s`。snapshot 过滤以 committed_at 为准，必要时同时限制 observed_at，防止未来离线标注回灌到过去。

## 训练 tensor batch

```text
context_images         float32 [B,Tc,3,H,W]   RGB / [0,1]
context_valid          bool    [B,Tc]         True=有效，至少一帧
context_times          float32 [B,Tc]         相对 anchor 的秒数
teacher_images         float32 [B,Tt,3,H,W]
teacher_valid          bool    [B,Tt]
teacher_times          float32 [B,Tt]
memory_features        float32 [B,K,Fm]
memory_valid           bool    [B,K]          K 可为 0；模型内部有 null token
teacher_support        bool    [B,Hb*Wb]
target_region          bool    [B,Hb*Wb]
semantic_labels        int64   [B,Hb*Wb]       -1 为 ignore
```

参考实现 Fm=12，仅是最小张量协议：实体类型 one-hot 6 维，归一化 x/y 2 维，方向 cos/sin 2 维，support/status 2 维。真实 tokenizer 需要扩展关系编码与未知值 mask；不要用 x=0 替代未知坐标而不加有效位。

PyTorch attention padding mask 的 True=忽略，与本协议 valid=True 相反，转换只在模型边界做一次。

## 标签与支持度

结构标签至少拆分 semantic / boundary / opening / relation；unknown 不是“空地”。观测支持 mask 可以来自 Blender 可见性或人工，但不能直接拿完整 GT 占据图做 visibility。

同一 chart 下，teacher support 与 context support 可以不同。目标分支有额外视角不代表全图有效。顶部二维 gt 的货架 footprint 与可见的侧面证据要按关联规则处理，不把相机看到货架顶面当唯一可见标准。

## 数据加载下一阶段必须完成

读取 JSONL、真实 RGB、标签 npz/json；统一 resize/letterbox，并同步图像坐标元数据。只允许符合 chart 语义的 augmentation；单独翻转 RGB 而不调整 side、方向和标签属于错误。

缺少图像：报包含 sample_id 的错误。只有拓扑标注：用于图关系/身份训练，跳过逐格 BEV loss。没有标签：可以做受约束的视觉预训练，但不能假装存在 BEV 真值。

当前 manifest CLI 验证身份、时间、防泄漏与 chart 基本字段；它不是完整真实图像 loader。文件示例是 schema fixture，不包含图片。

## 初始语义 taxonomy（正式数据接入时版本化）

四类互斥 BEV 语义的初始约定：0=已标注可行走地面，1=货架/冷柜等固定设施占地区域，2=墙体等固定结构障碍，3=其他已观察的不可行走区域；-1=未知/不监督。开口、端架、边界和观测支持使用独立通道/关系标签，不强迫它们与地面互斥。设施完整 footprint 可作为有来源的结构监督，但只有实际支持的部分进入 observed evidence。骨架随机标签仅遵守类别编号，完全不具有这些语义。
