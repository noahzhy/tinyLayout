以当前目录为项目根目录，先阅读 START_HERE.md、AGENTS.md、
IMPLEMENTATION_STATUS.md 和 docs/07_implementation_plan.md。

先复现现有测试、CPU smoke、graph demo 和 manifest validator，
再按阶段计划从第一个未完成阶段推进。

保持“局部结构 BEV → 拓扑条件 JEPA → 增量二维拓扑图”的主线。
优先落实数据协议、局部坐标、可见性掩码和防泄漏约束。

每阶段交付代码、对应测试、实际运行命令、输出路径和剩余阻塞，
并更新 IMPLEMENTATION_STATUS.md。不要把随机张量测试写成真实建图能力。

约束条件：如果要训练代码，只能用 GPU1 单卡。
