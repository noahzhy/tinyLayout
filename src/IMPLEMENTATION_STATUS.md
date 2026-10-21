# 实施状态 · 0.1.0

状态是实际交付边界，不表示方法已验证有效。

## 已包含

- [x] 中文方案、坐标/数据/图接口、阶段任务、Codex 启动指令。
- [x] 小 CNN + 时空位置编码 + BEV queries 的最小 PyTorch encoder。
- [x] 拓扑特征 token 接口、null-memory、JEPA predictor 与 EMA target。
- [x] masked JEPA loss、已知语义 loss、基础结构/action heads。
- [x] 已对齐同一 chart 下的候选预测能量接口；低 support 拒绝。
- [x] 基本 manifest 防泄漏检查。
- [x] 带 evidence 门控、平行边和撤销日志的最小 GraphStore。
- [x] 无网络 CPU smoke、图 demo 和自动化测试；实际结果见 verification。

## 仍需实施

- [ ] P1：真实图像与标注 loader、collate、完整 schema、按 store 划分和可视审核。
- [ ] P2：Blender 渲染器/导出适配、可见性标签与真实门店标注。
- [ ] P3：正式 backbone、真实/合成结构训练、方差监控、完整 checkpoint/resume。
- [ ] P4：节点/端口/边/边界集合 decoder、匹配、顺序/side 关系 loss。
- [ ] P5：真实图 tokenizer、跨 chart 方向/端口对齐、反事实训练、阈值校准。
- [ ] P6：视频/任务流增量推理、节点 alias、图事件重放、自动布局与 SVG/HTML。
- [ ] P7：目标硬件 profile、导出与量化一致性。

## 特别说明

随机张量的训练 loss 不代表有效 BEV。Graph demo 的证据是手工 fixture，不是模型判断。骨架中的 evidence certified 标记信任受控上游，尚不支持从任意图片自动认证通行事实。未提供模型权重、真实数据或实验精度。
