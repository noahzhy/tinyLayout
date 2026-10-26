# 合成数据工作台（桌面端）

从仓库根目录执行 `npm ci`、`npm run dev`。使用 React/Vite/TypeScript，场景、采集、标签和导出逻辑均位于 `src/synthetic/`，CLI 与网页共享这些模块。界面仅面向桌面端。

## 批量入口

```bash
npm run synth -- --help
npm run synth -- generate --config configs/synthetic.json --output runs/synthetic
```

布局类型为 `mixed`（混合陈列，默认）、`islands`（岛式展架）、`rooms`（带门洞的分区房间）、`grid`、`cross`、`T` 和 `dead_end`。新类型随 seed 改变货架的长短、数量、横竖方向和错列，通道宽度、入口和房间布局也会变化；网页“换一个布局”自动递增 seed。CLI 批量生成遵循配置指定的类型。

统一 XY 地面/Z 向上，图边方向定义为 `a→b`，货架 side 相对该方向。布局变化产生新的 store ID，轨迹变化不产生新店。GT 图是场景构造的静态通道连通监督。新类型的轨迹沿构造图行走，并为每个转角保留实际帧，防止低帧率采样直接穿过货架。

两条采集任务覆盖前进、侧扫、停留、反向观察，以及有实际空间跳变的分段重启。窗口不跨 segment。8 帧窗口中前 4 帧为 context，后 4 帧为 teacher-only；网页按当前 8 帧审核窗口显示颜色，导出还包含 stride=4 的重叠窗口。

RGB 使用显示 framebuffer；ID/深度使用独立线性 RGBA8 target、禁用 AA/tone mapping。深度以原始 RGBA 字节保存，避免 canvas alpha 预乘破坏编码，排列为 bottom-up；编码见 three r180 `packing.glsl.js`。每 4 像素采样一个首表面命中，投影到同一 anchor chart，保守生成 support。遮挡物仅挡视线，不标记其后方不可见地面；货架侧面只支持实际命中的局部 cell。全局 GT、相机、深度和实例 ID 单独导出，不写入 RGB。

## 额外采集与标签导出

```bash
# 单店闭环采集数据与多店闭环数据；benchmark-train 只生成数据，不训练模型
npm run synth -- benchmark --config configs/mapping_benchmark.json --output runs/benchmark
npm run synth -- benchmark-train --context-frames 2 --config configs/association_loops.json --output runs/loops

# 向闭环采集数据集补充入口采集任务
npm run synth -- entrance-capture --root runs/loops --output runs/with_entrance

# 从已保存的实例/depth pass 重新导出可见表面标签，保持 RGB 不变
python3 -m pip install -r requirements.txt
npm run synth -- relabel --root runs/loops --output runs/relabeled --python python3

# 单帧局部刚性结构标签
npx tsx web/cli/structure-labels.ts --root runs/loops --output runs/structure_labels --python python3
```

`entrance-capture`、`relabel` 和 `structure-labels.ts` 使用 `benchmark-train` 的按店目录结构，不能直接读取普通 `generate` 或单店 `benchmark` 的导出目录。

`relabel` 可将历史 1.1 可见表面标签升级为 1.2；已经是 1.2 的结构标签保持原样，并校验原始传感数据与其余标签不变。

## 离线测试与浏览器验收

```bash
npm test
npm run build
# 先生成小型 CLI 对照集；该目录若已存在，请指定新目录并设置 TINYLAYOUT_PARITY_ROOT
npm run synth -- generate --config configs/synthetic_probe.json --output runs/synthetic_probe_final
# 另一个终端保持 npm run dev 运行
npm run test:e2e
```

通过 `TINYLAYOUT_CHROMIUM=/path/to/chrome` 指定 Chromium。Browser 插件不可用时使用 Playwright。测试拦截所有外网请求；验证页面、控制台、参数错误、帧/mask 切换、配置往返、ZIP、网页/CLI 标签与 RGB 一致性，以及真实渲染遮挡。默认保存桌面截图与结果到 `runs/browser_qa/`。`TINYLAYOUT_URL`、`TINYLAYOUT_QA_DIR`、`TINYLAYOUT_PARITY_ROOT` 可覆盖入口和产物目录。

本程序只生成合成场景与标注，没有真实商品资产或真实门店验证。反事实 pair 仅在支持区域存在结构差异时标记 `ranking_valid`。
