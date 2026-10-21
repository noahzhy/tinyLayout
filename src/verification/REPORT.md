# 交付验证报告

验证日期：2026-10-21。所有结果来自本次实际执行，不是预期值。

## 实际环境

Python 3.13.5，PyTorch 2.10.0+cpu，pytest 9.0.2，PyYAML 6.0.3。CPU，单线程 smoke；没有 CUDA/GPU 测试。详细见 environment.json。其他 Python/PyTorch 版本未逐一验证。

## 已执行

| 命令 | 实际结果 | 记录 |
|---|---|---|
| `PYTHONPATH=src python -m pytest -q` | 42 passed | pytest.log |
| `python -m structmap_jepa.training.smoke --config configs/smoke.yaml --steps 3 --output verification/smoke` | 3 次前向/反向/EMA；loss 和候选能量有限 | smoke/metrics.json、smoke_console.log |
| `python -m structmap_jepa.graph.demo --output verification/graph_demo` | 预测无法认证通行；已认证边可撤销；日志保留 | graph_demo/*.json |
| `python -m structmap_jepa.data.manifest examples/window_manifest.json` | schema 与基本防泄漏检查通过；未检查占位图片文件 | manifest_console.log |
| `python -m compileall -q src tests` | 通过 | 无错误输出 |
| `python -m pip install --no-deps --no-build-isolation -e .` | editable 安装成功，安装后 CLI 可调用 | editable_install.log、installed_cli.log |

smoke 配置在线可训练参数：42,281；额外 EMA 教师参数：31,136。这是小型测试配置，并非推荐最终研究模型参数量。

## 不得扩大解释

随机 tensor 与随机标签不说明学会了 BEV。candidate energy 数值不是召回率/置信度。图示例是人工 fixture。未执行真实数据训练、Blender 渲染、相机对齐、完整图关系解码、端侧测速或消融研究。

本包没有 checkpoint、预训练权重或客户图片。解压后复验记录见 archive_recheck.log（打包阶段执行）。

## 额外检查

- `configs/research.yaml`：随机输入前向通过，输出与目标均为 `[2,256,128]`，数值有限；见 research_shape_check.json。仍不是结构学习或精度验证。
- 从 ZIP 解压到独立目录后，显式导入解压目录的 src，再次执行测试、smoke、graph demo 和 manifest；42 项测试通过，其余命令成功。见 archive_recheck.log。
