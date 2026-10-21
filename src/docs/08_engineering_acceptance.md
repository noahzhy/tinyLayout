# 08 · 工程验收清单（不含消融计划）

## 自动化必须覆盖

- 张量 shape、时间编码、mask 正反语义、空 memory。
- 全 padding 窗口明确报错；部分 padding 内容变化不改变输出。
- target 分支无梯度；model.train() 不把 teacher 切回训练；EMA 更新顺序正确。
- 无 teacher support 时 loss=0 且可反向，无 NaN；关联 support 不足时返回 invalid/+inf。
- context 和 hidden frame ID 不相交；anchor 属于 context；snapshot 不包含目标 evidence。
- 时间阈值、同店数据划分、图/图片路径匹配。
- 未知标签 ignore；预测 support 不自行认证事实。
- 同货架/同地点不能认证通道；认证通道的端点与证据绑定一致。
- 边撤销保留事件和原证据；允许不同通道形成多重边。
- 结构 query 容量溢出可见，不静默丢节点。
- checkpoint 恢复后配置、teacher、optimizer 和随机状态可追溯。

## 数据通过条件

人工核对 RGB 与局部 BEV 的前/后/左/右对应、anchor、支路和货架边界；teacher_support 与真实可见区域一致。数据集生成应报告未知/有效比例和拒绝样本原因，避免全部有效或全部忽略。

## 功能通过条件

对人工可确认的采集任务，输出可追溯图；每条 verified 边能定位原始通行证据；遮挡/异地重启不产生凭空连接；同一门店的回访可以保持候选直至证据充分。

不设置未经业务验证的精确率门槛。阶段报告必须记录实际错误连接、漏连、顺序冲突、未解决组件和覆盖范围；不能只展示最成功样本。

## 轻量实现记录

记录设备型号、线程数、输入尺寸、T/N/K/C、batch、warm-up、精度模式、峰值内存、模块耗时。CPU smoke 的耗时不是手机端性能；不同设备数值不可直接类比。

## 故障时优先排查

“BEV 很像但接错”：检查 chart、side、端口参照、地图泄漏和 observation 是否读了候选。

“预测 loss 很低但没结构”：检查常量/位置编码捷径、mask 全空、teacher 塌缩、缺结构监督。

“所有候选得分相同”：检查 memory token 被 padding、反事实未改变有效可见结构、predictor 忽略记忆。

“全图完整得异常”：检查是否将 inferred/candidate 渲染成 verified、未知当空地、绘图交叉当路口。
