# 06 · 全局图、局部记忆与证据状态

## 图对象

`G=(V,P,E,R,B)`：节点 V、端口 P、通道多重边 E、顺序/方向关系 R、货架面边界 B。

节点：junction / portal / entrance / dead_end / frontier。采集结束是 frontier，不自动变成 dead_end。主通道上的不同支路口分别建节点并保留顺序，不压成单个超级节点。

端口：绑定节点，记录已观察开口和局部方向/环绕顺序；方向不可靠则 null。边连接 `(node,port)` 对，而非任意中心点。两个节点之间允许不同通道形成平行边。

边界：货架面与整排货架实体分开。先记录沿有向通道的 side 和顺序，双向经过需要进行参照方向转换。

## 不同证据不能混用

- `visual_similarity`：仅候选。
- `same_place_verified`：支持地点身份，不支持穿过二者的新通道。
- `same_landmark`：共同观察货架/标志，不证明可通行。
- `observed_traversal`：连续经过且确认端点端口，可用于通道事实。
- `human_confirmed_connection`：人工明确确认通行关系。
- `model_prediction`：仅推断，不能单独升级 verified。

每条证据记录 frame IDs、segment IDs、时间、来源和端点 binding。`observed_traversal` 的有效性需要上游通行验证模块/人工审核，不得仅凭 timestamp 连续就打这个标签。当前骨架假定外部提供的 certified 证据已经完成该审核，不具备从视频自动认证能力。

## 状态与动作

地图状态：candidate / verified / rejected / revoked。原始证据保留，状态变更写入 append-only event log；撤销不删除过去事件。

模型动作：EXTEND、ADD_NODE、REVISIT、DEFER。action_head 给提议，GraphStore 校验事实关系后提交。地点合并采用 alias/same-place 边，禁止不可逆 union 丢失原 ID。

核心门控：预测分数再高，没有认证过的通行证据也不能将边升级 verified。连接状态独立于识别置信度。绘图中两线交叉也不生成新的 junction。

## snapshot 与特征记忆

历史 memory 的每个 token 保留 origin object/evidence IDs、observed_at、committed_at。生成训练样本时使用冻结 snapshot，exclude 本窗口证据；正负候选使用同样的截断时间。

局部 memory 读当前候选一跳或两跳子图，优先节点/端口/已验证边，再排序/边界，最多 K 个 token；溢出时保留 truncation 信息。记忆编码必须表达关系，不能只把节点坐标拼起来当整张图。

新店为空图时使用 null-memory，明确区分“没有历史记忆”和“历史证明该处为空”。

## 输出

`graph.json` 包含对象、事件、证据与未知组件；`layout.json` 后续补 schematic_xy，真实尺寸字段为 null。渲染 verified 与 candidate 应可区分；未关联组件不能为美观连到主图。

最小实现提供单边认证/撤销和 journal；节点 alias、关系预测写入、事件重放后的全局一致性和 SVG 渲染仍属后续阶段。
