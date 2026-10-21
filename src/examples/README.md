# 示例边界

`window_manifest.json` 是字段与防泄漏校验 fixture；其中 image_path 故意为占位路径。普通 validator 检查结构；`--root <dataset> --check-files` 才检查图片存在。

`python -m structmap_jepa.graph.demo` 生成手工图事件示例，非模型建图结果。`training.smoke` 使用随机 RGB 和随机标签，仅测接口/梯度，不应作为训练数据。
