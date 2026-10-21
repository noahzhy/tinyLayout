# StructMap-JEPA · Codex 实施交付包

**版本：0.1.0 / 2026-10-21**  
**目标：RGB 短序列 → 局部结构 BEV → 拓扑条件 JEPA 预测 → 地点与端口关联 → 全局二维 Store Layout。**

优先保证通道连接、支路排列和货架侧别正确；输出非等比例示意图，不承诺米级测量。JEPA 预测器同时用于训练和线上关联，不退化为传统建图管线的特征提取器。

## 从这里开始

将整个文件夹交给 Codex，先读取 `START_HERE.md`、`AGENTS.md`、`IMPLEMENTATION_STATUS.md`，再按 `docs/07_implementation_plan.md` 推进。可以直接复制 `prompts/00_bootstrap.md`。

```bash
# Python 3.10+；只读验证应先尝试直接使用已有环境
python -m pip install -e '.[dev]'
python -m pytest -q
python -m structmap_jepa.training.smoke --config configs/smoke.yaml --steps 3 --output runs/smoke
python -m structmap_jepa.graph.demo --output runs/graph_demo
python -m structmap_jepa.data.manifest examples/window_manifest.json
```

本包的实际验证环境、命令和结果见 `verification/REPORT.md`。若 GPU 版本安装需要特定 CUDA wheel，使用所在环境的正确 PyTorch 安装方式；本包不替换已有 GPU 环境。

## 包含什么

| 内容 | 入口 | 状态 |
|---|---|---|
| 最终方案与范围 | `docs/00_solution_summary.md` | 已整理 |
| 架构、坐标、模型与损失 | `docs/01` 至 `03` | 实施规格；不是已验证算法结论 |
| 数据协议、Blender 与真实数据生产 | `docs/04`、`05` | 协议与待办，无真实门店数据 |
| 图、证据、可撤销更新 | `docs/06_topology_memory.md` | 规格 + 最小运行实现 |
| 阶段任务与验收 | `docs/07`、`08` | 面向 Codex 的依赖顺序 |
| PyTorch 最小骨架 | `src/structmap_jepa/` | 可运行张量链路、EMA、损失、关联评分接口 |
| 自动化检查 | `tests/` | 张量、掩码、防泄漏、图状态、EMA 等工程测试 |
| 资料与创新边界 | `docs/09_references_and_limits.md` | 原始论文 / 官方文档来源 |

## 当前能够做什么，不能做什么

代码可以在 CPU 上运行随机张量的前向、反向、EMA 更新和候选评分；可以演示证据驱动的图状态变更和撤销。**这只验证接口和数值流程，不证明模型已经学会 BEV、地点识别或商超建图。**

尚未提供真实数据训练、预训练权重、完整拓扑关系解码器、跨窗口对齐、真实数据流推理或自动布局渲染。最小图示例是手工构造的输入事件，不是模型重建结果。

## 固定范围

- 输入：RGB 图片、时间戳、片段与任务元数据；约每 0.5 秒采一张，可中断、侧拍、转手机。
- 输出：单层门店的通道/路口/端口/货架面关联、顺序关系、证据和未知区域。
- 主线：跨视角 BEV-JEPA、拓扑条件预测关联、二维反事实记忆。
- 不建设 VO / SLAM / SfM / GlueMap / VidMap 后端；不把深度、点云或绝对相机轨迹列为前置条件。
- 本轮不安排消融研究；保留实现所必需的单元测试、数据检查和功能验收。
- 没有训练数据或相机几何证据时，不声称任意 RGB 能恢复可靠米制 BEV。

所有默认网络尺寸、损失系数和阈值均为初始工程参数，未经过性能验证。
