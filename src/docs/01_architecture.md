# 01 · 系统架构与接口

## 模块链

| 模块 | 输入 | 输出 | 主要职责 |
|---|---|---|---|
| WindowBuilder | 帧、时间、片段边界 | context / target / anchor、valid masks | 切分观察，禁止跨断序列强接 |
| ImageEncoder | B,T,3,H,W | B,T,P,D | 每帧只编码一次；保留图像二维位置 |
| BEVLifter | 图像 token、时间、局部查询 | B,N,D；N=H_b×W_b | 学习跨视角结构汇集，无体素和深度提升 |
| IdentityHead | 图像/BEV 池化 | B,D_id | 候选召回，不直接决定合并 |
| LocalMemoryEncoder | 当前时刻前的子图 snapshot | B,K,D + valid | 节点、端口、边、顺序和证据状态 |
| BEVJEPAPredictor | context BEV + memory + target queries | B,N,D | 预测目标局部结构 latent |
| StructureHeads | observation / predicted BEV | 语义、可见性、实体/关系查询 | 空间与拓扑双头，不只依赖骨架化 |
| Association | 候选预测、独立观察、support | 分数、方向/端口、DEFER | 在线预测一致性 |
| GraphStore | 带证据的提议 | 图状态、事件日志 | 多重边、撤销、snapshot |
| LayoutExporter | 正式图与未知组件 | JSON；后续 SVG/HTML | 保持连接与顺序，非米制排版 |

## 训练路径

context images → online encoder/lifter → B_C；
extra real views（可包含 context）→ EMA target encoder/lifter → B_T，stop-gradient；
B_C + frozen prior memory → predictor → B_hat；
用目标支持 mask 比较 B_hat 与 B_T，并用二维结构标签锚定在线 BEV 的空间语义。

EMA 教师不能读取 GT 连接作为输入。GT 用于标签和有效区定义，不可替代视觉推断。结构 encoder 的独立图监督变体留作未来扩展，本版只有一个明确的视觉 BEV 教师，避免两套互不对齐的目标空间。

## 在线路径：所有图片已经到达

在截至当前时间的窗口内，划分较早 context 和留出 observation；候选预测器只看 context 与先前 snapshot，独立观察分支只看已到达的 observation/共享 anchor，不看候选地图。比较两者后再更新图。

没有独立可见 target 时先积累，不用“同一组图片预测自己”冒充跨视角检验。允许产生窗口积累延迟，但不等待未来未到达数据后宣称实时。新地点/图为空必须使用 learnable null-memory 路径。

## 内存与复杂度

先取一跳/两跳有界子图，最多 K 个 token；整店图不直接送 Transformer。图像特征按帧缓存，BEV 只缓存代表性地点。候选数 C、窗口 T、BEV token N、图 token K 在配置中有上限；记录实际计算量和显存，禁止把小 token 数直接写成设备 FPS。

原型使用标准 cross-attention；若使用 N=512，注意 BEV self-attention 的二次开销。上线后再替换为稀疏/局部注意力，而不是先引入复杂自定义 CUDA。

## 现在的骨架

`BEVEncoder` 已实现共享小 CNN、图像二维位置、帧时间编码与 BEV 查询；`StructMapJEPA` 包含 EMA、predictor、结构头与候选误差接口。局部记忆当前通过规定的数值特征投影为 token，真实图 tokenizer 尚待实现。

已有 semantic_head / evidence_head / global action_head 只是 tensor prototype；不是完整的端口、边和顺序 decoder。完整关系头必须按 P4 实现，不能把随机 logits 写进地图。
