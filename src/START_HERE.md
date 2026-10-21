# 给 Codex 的启动说明

## 用户已经确定的方向

这不是重新选型任务。请沿着 **局部结构 BEV + JEPA + 全局二维拓扑图** 实施。

最重要的约束：拓扑正确优先；JEPA 必须进入核心预测与线上关联；不要回到轻量 VO、SfM 或三维重建兜底；本阶段不做消融实验。

## 建议读取顺序

1. `AGENTS.md` 与 `IMPLEMENTATION_STATUS.md`：工作约束和已实现边界。
2. `docs/00_solution_summary.md`：最终方案。
3. `docs/02_bev_coordinates.md`、`docs/04_data_contract.md`：先统一坐标和数据，避免代码先跑、语义后补。
4. `docs/03_model_and_losses.md`、`docs/06_topology_memory.md`：模型及图更新接口。
5. `docs/07_implementation_plan.md`：按依赖顺序逐阶段推进。

## 第一轮工作的实际终点

先复现已有测试和 CPU smoke，检查代码边界，随后完成 P1 的真实样本协议与数据加载。数据缺失时实现适配器、校验器与明确报错，不用伪造门店数据绕过问题，不宣称 P1 的真实数据验收通过。

P0 通过不代表算法有效；P1～P7 以状态文件为准。先结束一个阶段，再更新文档、测试和状态。

## 可直接给 Codex 的指令

> 请以当前目录为项目根目录，首先阅读 START_HERE.md、AGENTS.md、IMPLEMENTATION_STATUS.md 和 docs/07_implementation_plan.md。保持 RGB→局部结构 BEV→拓扑条件 JEPA→增量拓扑图的主线，不增加 VO/SLAM/SfM/GlueMap 依赖，不安排消融。先运行已有测试与 smoke，记录实际结果，再从第一个未完成阶段推进。每阶段交付代码、对应测试、运行命令、输出路径、剩余阻塞和更新后的状态。随机张量测试不得写成真实地图性能；没有数据时继续完成可独立验证的接口和工具，并明确数据阻塞。
