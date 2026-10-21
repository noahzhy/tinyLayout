# 03 · 模型与训练规格

## 默认网络

研究配置建议 T≤8、BEV=16×16、D=128、identity=256、局部记忆 K≤64、候选 C≤5。全部是工程初值。骨架用无下载的小 CNN；正式训练换成可训练的小型视觉骨干，但保持接口不变。

图像 token 加二维位置和相对 anchor 时间编码；不只按帧序号编码，否则时间间隔变化无法表达。BEV queries 同时包含二维坐标编码与可学习查询。先用 2 层跨注意力，避免用未受监督的 reshape 宣称已得到 BEV。

## 训练伪代码

```python
ctx = online(context_images, context_valid, context_time)
with no_grad():
    target = ema_teacher(teacher_images, teacher_valid, teacher_time)
# target/teacher_images 不进入 ctx 或 predictor
pred = predictor(ctx.bev, prior_memory_tokens, memory_valid)
mask = teacher_support & target_region
loss_jepa = masked_latent_distance(pred, target.bev, mask)
loss_structure = known_structure_loss(heads(ctx.bev), context_labels)
loss = loss_jepa + lambda_structure * loss_structure + other_supported_losses
loss.backward()
optimizer.step()
update_ema_after_step()
```

教师永久 eval，参数无梯度。EMA 在 optimizer step 后更新 encoder/lifter 的参数与 buffer；不把 predictor 放进 teacher。部署使用同一套 encoder 权重定义观察和预测空间；若改用 EMA encoder 导出，需要验证 predictor 与该表征的兼容性，不能静默替换。

## 训练目标

L = λj·L_JEPA + λs·L_structure + λa·L_association + λg·L_graph + λr·L_regularization。

| 项 | 定义与适用性 |
|---|---|
| JEPA | 在有效目标 cell 上，对 feature-wise normalized latent 做 SmoothL1 或 cosine distance；无有效 cell 时返回可反传的零值并记录计数 |
| structure | 已知 cell 的语义 CE、多标签边界/开口 BCE、支持度 loss；缺失标签必须 ignore |
| association | 正确记忆预测能量更低；只使用明确不同物理地点且观测能区分的困难负样本 |
| graph | 端口、边、顺序、side、action；只在匹配后的实体上监督，不把 query slot ID 当地点身份 |
| regularization | 监控 embedding 方差与有效秩；需要时加方差/协方差项，防常量或纯坐标编码解 |

图 topology 标签只在关系层使用；不能让完整 GT 图穿透进 memory 输入。阶段 smoke 只启用实际已有标签对应的 loss；未实现的 loss 不能用常数/随机数占位后声称训练完成。

## 反事实记忆

保持外观相似，改变一项有真值的关系：端口环绕顺序、主通道支路排列、货架侧别或已确认边界上的错误通行边。自然错误候选优先；合成修改要保留合理节点度数和 token 数量，避免仅靠图大小/非法语法识别负样本。

`L_cf = max(0, margin + E_positive - E_negative)`。正负记忆必须读取相同时刻的 snapshot、使用相同候选 token 预算；在目标可见区域不产生可识别差异的样本不施加此 ranking。反事实 loss 是任务辅助，不把全系统宣称为“纯 JEPA，无监督、无负样本”。

## 在线能量与拒识

`E(v,h)=mean_visible distance(P(B_context, M_v, h), B_observation)`，h 为方向/端口对齐假设。实际评分加入重叠覆盖率、结构冲突和身份召回分数；不直接把 E 转成未经校准的置信概率。

仅在至少规定的 support 数量下评分；无 support 返回 +inf/invalid。候选之间必须使用可比较的支持区，不能靠只对齐一个容易 cell 得到低误差。

无历史地图走 null-memory；未知地点也保留候选。阈值、最佳/次佳间隔、最少支持量需要在开发数据上校准，本包不提供生产阈值。

## 完整关系 decoder（待实施）

实体查询输出 node/port/boundary/no-object，坐标仅为本 chart 的归一化位置。使用二分图匹配或等价的顺序不变监督；polyline 端点顺序允许合法置换，端口环绕顺序则不能任意交换。关系头读取匹配的实体查询，输出连接、顺序、side 和 graph-action；现有 global action_head 不能替代这一层。

没有节点上限保证时，decoder 容量溢出必须输出 overflow 并缩小窗口/分区域处理，不能悄悄丢掉端口。
