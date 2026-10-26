# tinyLayout · 合成商店数据生成器

桌面网页与 CLI 共用场景、相机轨迹、渲染、标签和导出代码。支持混合陈列、岛式展架、分区房间，以及网格、交叉通道、T 形支路和尽头。

默认使用混合陈列：seed 会改变货架数量、长短、横竖朝向、错列位置、通道宽度、入口位置和分区房间。点击“换一个布局”即可切换到下一个 seed；固定 seed 可复现。批量生成遵循配置指定的布局类型。

## 启动网页

```bash
npm ci
npx playwright install chromium  # 本机尚未安装 Chromium 时执行
npm run dev
```

打开终端显示的本地地址。网页提供 3D 场景、全局俯视 GT、透视 RGB、局部 BEV 标签四个视图，以及帧切换、mask 切换、配置保存/载入和 ZIP 导出。仅支持桌面端。

## CLI 生成数据

```bash
# 默认 12 店，按店划分 train/dev/test 为 8/2/2
npm run synth -- generate --config configs/synthetic.json --output runs/synthetic

# 小型验证集：1 店、32 帧、192×144 RGB
npm run synth -- generate --config configs/synthetic_probe.json --output runs/synthetic_probe

# 查看全部数据生成命令
npm run synth -- --help
```

CLI 使用无界面 Chromium 与软件 WebGL2，无需 GPU。可用 `TINYLAYOUT_CHROMIUM=/path/to/chrome` 指定已有浏览器。输出目录必须尚不存在。

数据包含 RGB、帧索引、窗口 JSONL、局部 chart、可见性/support/target mask、局部标签与图、全局场景 GT、按店划分及 provenance；实例 ID 和深度单独保存。只有带 `COMPLETE` 标记的目录表示导出完成。这些是合成数据与 GT，不是模型预测结果。

额外采集与重标命令见 [网页及 CLI 说明](web/README.md)。

## 测试

```bash
npm test
npm run build

# 包含可选 PNG 解码脚本的测试，需要安装 Pillow
python3 -m pip install -r requirements.txt
TINYLAYOUT_PY=python3 bash scripts/check_all.sh

# 网页配置、帧/mask、ZIP 及网页/CLI 一致性验证
npm run synth -- generate --config configs/synthetic_probe.json --output runs/synthetic_probe_final
# 另一终端保持 npm run dev 运行
npm run test:e2e
```

测试只访问本地服务。`TINYLAYOUT_URL`、`TINYLAYOUT_QA_DIR`、`TINYLAYOUT_PARITY_ROOT` 可覆盖浏览器测试地址、产物目录和 CLI 对照目录。

## 目录

```text
configs/                  场景与采集配置
web/src/synthetic/        场景、轨迹、渲染、标签、GT 与导出
web/src/components/       桌面可视化组件
web/cli/                  批量生成、采集补充与标签重导出
web/tests/                生成器单元测试与桌面浏览器测试
scripts/                  检查入口与实例 PNG 解码辅助脚本
tests/                    PNG 解码协议测试
```
