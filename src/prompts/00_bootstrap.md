# 复制给 Codex 的首轮任务

请在当前项目目录实施 StructMap-JEPA。先读 START_HERE.md、AGENTS.md、IMPLEMENTATION_STATUS.md 和 docs/07_implementation_plan.md。

沿用局部结构 BEV、拓扑条件 JEPA 预测、全局稀疏二维图。JEPA predictor 必须在线保留；不引入 VO/SLAM/SfM/GlueMap/深度重建替代路线；本轮不安排消融。

先复现 tests、CPU smoke、graph demo 和 manifest validator，再从第一个未完成阶段开始。第一优先是数据契约、局部 chart、support mask 和防泄漏；不要绕过这些先画完整地图。

每次阶段结束报告实际修改、命令、结果、产物、未完成项与阻塞，并更新状态。缺真实数据时实现能验证的加载/检查/生成接口，不使用随机图片或 GT 俯视图冒充真实视觉学习。无需重问已经确定的算法方向；对低风险未定参数采用配置化默认值并记录。
