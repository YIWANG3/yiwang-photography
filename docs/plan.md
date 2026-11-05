# yiwang.photography 重建方案

> 2026-10-15 设计稿。原则（用户定）：**AfterFrame 只负责筛选，不加任何发布功能**；网站和发布链路全部在这个仓库。
> 设计方向见 [design-research.md](design-research.md)。费用和大陆可达性的调研结论在第 7 节。

## 1. 边界

```
AfterFrame（只读）                 本仓库                                    线上
┌────────────────┐   MCP 41706   ┌──────────────────────────┐              ┌──────────────────┐
│ 合集 = 系列      │ ───────────▶ │ publisher/  读合集、渲染、  │ ── S3 PUT ──▶│ 图床（R2 / COS HK） │
│ 原图在本机磁盘    │   读文件      │             上传、写清单    │ ── POST ────▶│ Pages deploy hook │
└────────────────┘              │ content/    标题、描述、色调 │              │ site/ 构建产物     │
                                │ site/       Astro 模板       │ ◀── build 拉 manifest ───────┘
                                └──────────────────────────┘
```

- AfterFrame 提供两样东西，都是它**已经有的** MCP 能力：`manage_collections(browse)` 给成员列表和顺序依据，`get_asset` 给原图路径、尺寸、方向、EXIF。不改 AfterFrame 一行代码。
- 本仓库的 publisher 在同一台机器上跑，直接读原图文件，用 sharp 渲染。
- 系列的标题、描述、色调、顺序规则、封面这些"网站才关心的东西"放在本仓库的 `content/`，不塞回 AfterFrame。
- Claude Code 是操作界面：`npm run publish` 或一句话"把 Kyoto 合集发布成画廊"。

## 2. 仓库结构

```
yiwang-photography/
  site/                 Astro 静态站（模板、样式、灯箱）
  publisher/            Node CLI：sync / render / upload / manifest / deploy
  content/
    galleries.yaml      系列清单（见 3.1）
    about.md            关于页
  state/
    published.json      已上传的派生图登记（哈希 → 档位），提交进 Git，便于换机器
  docs/
    plan.md             本文
    design-research.md  设计调研
    prototypes/         HTML 原型
  tools/
    migrate-squarespace.mjs   一次性：抓现站 → 对本地库 → 生成 galleries.yaml 草稿
```

单仓库、npm workspaces、Node 22。`site` 和 `publisher` 共用 `packages/manifest` 里的 schema（zod），构建时校验。

## 3. 内容模型

### 3.1 `content/galleries.yaml`

```yaml
site:
  title: Yi Wang
  image_base: https://img.yiwang.photography/i
galleries:
  - slug: tokyo-night            # 和现站一致，老链接不断
    collection: "Tokyo Night"    # AfterFrame 里的合集名（精确匹配）
    title: Tokyo Night
    year: 2023
    tone: dark                   # light | dark，见设计调研 §4
    order: captured_asc          # captured_asc | captured_desc | manual
    cover: _MG_4935              # 文件名 stem；省略则取第一张
    description: ""
    hidden: false
  - slug: sanfrancisco
    collection: "San Francisco"
    tone: light
    order: captured_asc
```

- 合集怎么选、哪些照片进去，**全在 AfterFrame 里做**（P 标记、搜索、拖进合集）。本文件只是把合集映射成网页。
- `order: manual` 时按 `collection_items.added_at`（加入合集的先后）排，这是 AfterFrame 现有数据里唯一可控的顺序；需要精细手排就在 AfterFrame 里按想要的顺序重新加入。
- 一个合集可以不对应任何画廊（AfterFrame 里几百个合集，只有列在这里的会发布）。

### 3.2 manifest（上传到图床，站点构建时读）

```jsonc
{
  "version": 1,
  "generated_at": "…",
  "site": { "title": "Yi Wang", "image_base": "https://img.yiwang.photography/i" },
  "galleries": [{
    "slug": "tokyo-night", "title": "Tokyo Night", "year": 2023, "tone": "dark",
    "description": "", "cover": "a1b2c3d4e5f6", "count": 13,
    "items": [{
      "id": "a1b2c3d4e5f6",                 // 派生哈希 = i/<id>/ 目录名
      "w": 6000, "h": 4000, "shape": "landscape",
      "sizes": [480, 1200, 2000, 3200],
      "alt": "",
      "exif": { "camera": "Canon EOS R5", "lens": "RF35mm F1.8", "focal": 35,
                "aperture": 1.8, "shutter": "1/250", "iso": 400, "taken": "2023-04" }
    }]
  }],
  "recent": ["a1b2c3d4e5f6", "…"]           // 最近发布的 60 张，给 /recent
}
```

不含 GPS、本地路径、asset_id。`taken` 只到月。

## 4. publisher

### 4.1 命令

| 命令 | 做什么 |
| --- | --- |
| `publish sync` | 连 AfterFrame MCP，把 `galleries.yaml` 里每个合集的成员拉下来，和 `state/published.json` 比，打印差异表（新增 / 重渲 / 不变 / 删除）。不写任何东西 |
| `publish run [--only slug]` | sync → 渲染 → 上传 → manifest → deploy hook。可中断，重跑从断点继续 |
| `publish doctor` | 检查 MCP 可达、桶可写（PUT + DELETE 一个字节）、deploy hook 可达、`galleries.yaml` 里的合集都存在 |
| `publish migrate` | 跑 `tools/migrate-squarespace.mjs`（见第 6 节） |

### 4.2 和 AfterFrame 的交互

- MCP 地址 `http://127.0.0.1:41706/mcp`（dev 版 41707，`AFTERFRAME_MCP_PORT` 覆盖），streamable-HTTP JSON-RPC。应用必须开着；没开就提示"打开 AfterFrame"。
- `manage_collections {action:"list"}` 找到名字匹配的合集 → `{action:"browse", collection_id, limit}` 翻页拿 asset 列表 → 对每个 `get_asset` 拿 `canonical_path`、尺寸、方向、EXIF、`display_shape`、`asset_type`、RAW 配对。
- 源文件策略：
  - JPEG / PNG / TIFF / WebP：直接读 `canonical_path`。
  - RAW+JPEG 配对：发 JPEG。
  - RAW 单独：sharp 不解 RAW。先 `generate_previews {kind:"hd"}` 让 AfterFrame 出 2000 px 的 HD 预览，用 `/assets/{id}?kind=hd` 取回；最大只能到 2000 档，超过的档位跳过。这是唯一的能力缺口，接受它（用户的库里 RAW 是轻量角色，发布的基本是 JPEG）。
  - HEIC：sharp 带 libheif 时直接读；否则 `sips` 转临时 JPEG（Mac）。
  - 视频：跳过并提示。

### 4.3 渲染（sharp）

| 项 | 规则 |
| --- | --- |
| 方向 | `rotate()` 按 EXIF 归一 |
| 颜色 | sharp 默认行为正好是要的：有 ICC 则转 sRGB 并剥掉 profile，不调 `withMetadata()` |
| 档位 | 480 / 1200 / 2000 / 3200 长边，`withoutEnlargement`；源不够大就跳过该档 |
| 编码 | WebP，480 档 q80，其余 q82，`effort 4`；AVIF 留到 P4 |
| 锐化 | ≤ 1200 档 `sharpen({ sigma: 0.6 })` |
| 元数据 | 全剥（默认）；EXIF 摘要来自 `get_asset`，写进 manifest |
| 哈希 | `source_key = sha1(canonical_path 的 fingerprint ‖ file_size ‖ modified_time ‖ RENDER_VERSION ‖ 档位表)`，`id` 取前 12 位。`RENDER_VERSION` 一变全量重渲 |
| 并发 | 渲染 `os.cpus()/2`，上传 4 |

### 4.4 上传

- S3 兼容 PUT / DELETE（`@aws-sdk/client-s3` 或 ~80 行 SigV4，二选一，后者零依赖）。R2、腾讯云 COS、阿里云 OSS、MinIO 都通。
- key：`i/<id>/<w>.webp`，`Content-Type: image/webp`，`Cache-Control: public, max-age=31536000, immutable`。
- `manifest.json`：`Cache-Control: no-cache`。
- 顺序：先传新图 → 写 manifest → POST deploy hook → 最后删不再引用的旧图（给构建留出窗口；删除延迟到下一次 run 也可以）。
- 每传完一张立刻写 `state/published.json`，中断可续。
- 凭证：`.env.local`（gitignore），或 macOS Keychain（`security find-generic-password`），不进仓库。

### 4.5 多目标（P4）

`targets: [r2, cos-hk]` 双写，`image_base` 切 CNAME 就能换线路；换的时候先对新目标跑一次全量 `publish run --target cos-hk`。

## 5. site（Astro）

- 页面：`/`（系列封面墙）、`/{slug}/`（系列页，按 `tone` 切整页配色）、`/recent/`、`/about/`、`/presets/`（外链或下线）、`/404`。
- 构建时 `fetch(MANIFEST_URL)`，zod 校验，失败则构建失败。本地开发可 `MANIFEST_URL=file:./fixtures/manifest.json`。
- 图：`<img srcset sizes loading decoding width height>`，首屏第一张 `fetchpriority="high"`；竖图并排时按 `shape` 排版。
- 灯箱：自写，键盘左右 / Esc，预加载相邻两张，按 `devicePixelRatio × 视口` 挑档位，右下角弱化 EXIF。
- 字体自托管；零第三方请求。
- 部署：Cloudflare Pages 连本仓库，`site/` 为根；push 触发构建，publisher 的 deploy hook 也触发。
- 测试：Playwright 冒烟（首页、一个 light 系列、一个 dark 系列、灯箱键盘）+ Lighthouse 预算（移动端 LCP < 2.5 s）。

## 6. 迁移（一次性）

`tools/migrate-squarespace.mjs`：

1. 抓 yiwang.photography 的首页导航拿到 18 个 slug，逐页抓 `images.squarespace-cdn.com/content/v1/…/<原始文件名>` 和页面标题。
2. 对每个文件名 stem 调 `search_assets {query: stem}`（或 `path` 过滤），命中唯一则记下 asset_id。
3. 输出：`content/galleries.yaml` 草稿（slug、title、collection 名建议）、每个系列的 asset_id 列表、未命中清单。
4. 建合集这一步**在 AfterFrame 里做**：脚本给出 `manage_collections create + add_items` 的参数，由 Claude Code 执行（这是 AfterFrame 已有的写能力，不是新功能）。
5. 人工核对一遍封面和顺序。

现站 `/presets`、`/cart` 不迁移；决定见第 8 节。

## 7. 基础设施与费用（2026-10-15 调研结论）

| 项 | 选择 | 月费 |
| --- | --- | --- |
| HTML | Cloudflare Pages | 0 |
| 图床 v1 | Cloudflare R2 + 自定义域 | 0（10 GB 免费，出站永久免费） |
| 图床 v2 | 腾讯云 COS 香港 + 境外 CDN | ¥10–50（亚太一区 0.46 元/GB，20–100 GB） |
| 域名 | DNS 迁到 Cloudflare（R2 自定义域的前提）；注册商可留 Squarespace 或转 Cloudflare | $28.20/年 |

大陆：不备案的上限是"能开、可接受"，边缘在香港 / 东京就能做到；美国源站（现状）做不到。验收用 17ce / boce 多节点测速，目标大陆主要省份系列页首图 < 3 s，达不到就切 v2。备案不考虑（需大陆服务器，`.photography` 大概率不在工信部后缀名单）。

## 8. 待拍板

| # | 问题 | 建议 |
| --- | --- | --- |
| 1 | `/presets` 商店 | 托管商店（Gumroad / Lemon Squeezy）+ 站内展示页外链；或下线 |
| 2 | 设计方向 | 档案型为底 + 系列级 `tone` 深浅切换（design-research §4） |
| 3 | 最大档位 | 3200 |
| 4 | 页面显示 EXIF | 显示相机 / 镜头 / 曝光，日期到月，无 GPS |
| 5 | 图床先 R2 还是直接 COS 香港 | 先 R2，测速不行再切 |
| 6 | 合集命名约定 | 用 `galleries.yaml` 的 `collection` 字段精确匹配，不要求 AfterFrame 里改名 |
| 7 | 用 `@aws-sdk/client-s3` 还是手写 SigV4 | 手写，零依赖、可读 |

## 9. 分期

| 阶段 | 内容 | 估时 |
| --- | --- | --- |
| **P0 设计原型** | 用真实照片做 HTML 原型：首页、light 系列页、dark 系列页、灯箱；手机 / 桌面各看一遍；定色值字号 | 1 天 |
| **P1 站点** | Astro 实现原型；手写一份 manifest 用 20 张图验证；Pages 部署；DNS 迁 Cloudflare；R2 自定义域；17ce 测速 | 1–1.5 天 |
| **P2 publisher** | MCP 客户端、渲染、SigV4 上传、state、manifest、hook；`sync / run / doctor`；假 S3 + 假 hook 的集成测试 | 2 天 |
| **P3 迁移切换** | migrate 脚本、18 个系列建合集、并行跑、切 DNS、退订 Squarespace | 0.5 天 |
| **P4 打磨** | 双目标、AVIF、部署状态轮询、about 长文、Recent 页细节 | 按需 |

## 10. 测试

- publisher 单元：差异四类、`source_key` 稳定、slug 校验、manifest 不含 GPS / 路径 / asset_id、SigV4 对照 AWS 文档样例。
- publisher 集成：假 S3（Node `http` 内存 dict，PUT / DELETE / HEAD）+ 假 hook + 假 MCP（录制的 JSON-RPC 响应），跑全量 / 增量 / 中断续跑。
- site：Playwright 冒烟 + Lighthouse 预算；构建时 manifest 校验。
