# 07 · Codex 分阶段实施计划

这里是工程推进顺序，不是消融研究。各阶段保留 BEV-JEPA 主线，不做传统建图替代方案。

| 阶段 | 目标 | 输入依赖 | 输出 / 完成条件 |
|---|---|---|---|
| P0 | 复现交付骨架 | 本包 | 所有现有测试、CPU smoke、图 demo 通过；记录真实环境 |
| P1 | 数据协议落地 | task metadata、少量 RGB/标签 | JSONL loader、split 检查、chart/support 可视审核、明确无标签路径 |
| P2 | 合成/真实局部结构数据 | Blender/标注 | 图像与二维标签同步导出、可见性 mask、反事实候选记录 |
| P3 | 有语义锚点的 BEV-JEPA 训练 | P1/P2 | 真实 RGB→BEV，结构监督、EMA、checkpoint/resume、数值稳定性 |
| P4 | 稀疏结构与关系 decoder | P3 latent + 图标签 | 节点/端口/边/顺序/side、集合匹配、overflow、图更新提议 |
| P5 | 在线预测式地点关联 | P3/P4 + 历史图 | 图 tokenizer、局部方向/端口对齐、独立 observation、反事实 ranking、拒识 |
| P6 | 任务流到布局 | P4/P5 | 分段增量、事件日志、撤销、未知组件、JSON + 非等比例 SVG/HTML |
| P7 | 轻量部署整理 | P6 可用链路 | 缓存、候选上限、profile、导出一致性、目标设备记录 |

## P0（交付时已跑过；新环境需重跑）

运行 README 命令。验证 0 support、空 memory、padding 帧、EMA 冻结、反向梯度、禁止预测升级通行边。读取 verification/REPORT.md，但不要用其中结果代替本机验证。

## P1

实现 `WindowDataset`、collate、样本可视审核工具和按 store 分组校验。strict 模式检查所有文件与 tensor shape；同一窗口必须只有一个 chart。支持 topology-only 样本，禁止生成假 BEV 标签。

当前 sample manifest 是 schema fixture，不是能训练的 dataset；必须明确真实图片路径。

## P2

独立实现 Blender scene adapter，不硬编码已有模型名称。固定种子，导出图片、实例 ID、visibility、结构关系与 snapshot。配一组人工可检查样本，检测标签坐标翻转和 future leak。

没有 Blender 环境时完成导出接口与脚本单元测试，并记录渲染未执行。

## P3

正式 backbone adapter 与 smoke backbone 并存；默认禁止自动下载。实现已知区域 CE/BCE、JEPA mask、训练配置和 checkpoint 恢复。报告已用数据、样本数、loss 构成与有效 support；不得仅靠总 loss 下降声明 BEV 准确。

完成可观察局部结构的质检与边界案例，不要求本阶段生成全店图。

## P4

实现结构查询和匹配监督；关系预测在 matched entities 上进行。完成主通道支路顺序、端口环绕关系、反向经过侧别转换。不从 skeleton 后处理替代整个学习头。

## P5

图/候选 tokenizer、方向/端口对齐和 candidate-independent observation。无对齐不做逐格能量比较；无 overlap 返回 invalid 而不是 0 分。校准拒识参数时记录数据来源，不把训练 margin 当生产阈值。

## P6

每次图更新有证据引用与事务 ID。对中断、歧义与未知组件能输出完整状态；一条通道误关联后可撤销而不破坏其他事实。渲染只是排版，不改变连接。

## P7

在保留 predictor 的前提下减少 token、缓存特征、控制 memory/C/T 上限。先测 PyTorch FP32/FP16，再考虑导出与量化；除了 latency，还检查关联排序、DEFER 和图事实状态一致性。

## 每阶段报告模板

使用 prompts/01_stage_report.md。包含实现文件、执行命令、实际结果、输出路径、数据/设备来源、未完成项、下一阶段阻塞。没有实测就写未测，不写估算速度为结果。
