# 作品集站设计调研

> 2026-10-15。看了 24 个站，分三类：成熟摄影师（艺术 / 纪实）、风光与 Instagram 系、AI 时代的高水准前端。每个站只记对我们有用的观察，不做全面评测。
> 结论在第 4 节：以"档案型"为底，用当代前端的排版纪律，夜景系列单独走深色。

## 0. 现站基线（yiwang.photography，Squarespace）

- 白底，左上小字 wordmark，导航 Works / Presets / Photo On Map，右上 Instagram 图标。
- 画廊页：顶部一条全宽横幅，下面 4 列等宽网格，每张图在 800 px 宽的窗口里只有 180 px 宽。**照片被当缩略图展示**，这是现站最大的设计问题，比加载慢更伤。
- 自带 cookie 横幅、字体从 Squarespace CDN 拉。
- 18 个系列按城市 / 主题命名（shanghai-i、tokyo-night、sanfrancisco-sunset …），这个"系列 = 一次旅行或一个主题"的组织方式本身是对的，值得保留。

## 1. 成熟摄影师（艺术 / 纪实）

| 站 | 观察 | 对我们的启示 |
| --- | --- | --- |
| **Takashi Yasui**（东京，Instagram 起家） | 纯白；首页一张全幅横图，往下是 3 列系列封面，标题就一行小字（"Tokyo Observations (2015–2024)" / Works / Travel / Portrait），页脚只有版权。没有导航栏，没有 about 入口在首屏 | **和我们题材、体量、出身最接近的样本**。克制到极致也成立。系列封面 + 一行标题 + 年份区间，是首页的好模板 |
| **Rinko Kawauchi** | 左侧固定一栏细衬线导航（News / Biography / Works / Publications…，EN / JP），右侧内容列；Works 页是系列列表（名字 + 年份），进系列后**单列大图纵向排**，一张一张看 | 单列纵向 + 年份列表 = 档案感。固定左栏在手机上要折叠，成本不高 |
| **Nadav Kander** | 白底小号无衬线；顶部导航分 4 组 12 项（Works in Series / Portraits / Commissions / Film / Archive / Monographs / Exhibitions…）；Works in Series 是 3 列封面，下方"Dark Line – The Thames Estuary · Series of 37" | "Series of N" 这个计数很好用，便宜又有档案味。导航 12 项对我们太多，我们 4 项以内 |
| **Greg Girard** | 白底，首页就是一张图的幻灯 + 左下角一行说明（"Platform Conductor Tokyo 1976"），右上汉堡菜单 | 图 + 一行"地点 年份"的 caption 风格，适合我们的城市系列 |
| **Michael Kenna** | 居中单图，衬线红色大写名字，像画廊墙 | 太古典，不取；但"每张图四周留白、图不贴边"是对的 |
| **Liam Wong**（东京夜景） | 近黑底，两列大图瀑布流，图之间几乎无缝；顶部一条书籍 / 签名版的推广条；小号大写导航 | **夜景在深色底上最好看**，白底会把霓虹"洗"掉。两列大图让每张都有尺寸。适合 tokyo-night / shinjuku / lights，不适合白天的 SF、Pacifica |
| **Alec Soth** | 芥末黄色块里一段手写口吻的自我介绍，粗体无衬线大导航，下面是博客式信息流 | 个性大于版式。我们不走这个方向，但"首页有一句人话"值得借 |
| **Magnum · Alex Webb** | 居中衬线名字，Profile / Highlight / Most Recent 三个 tab，横向图片带，衬线正文传记 | 编辑部风格；"Most Recent"这个维度提醒我们：除系列外可以有一个按时间倒序的"最近"页 |
| Saul Leiter Foundation / Fan Ho | 机构站 / 博客站，加载慢或信息杂 | 不取 |

## 2. 风光与 Instagram 系

| 站 | 观察 | 对我们的启示 |
| --- | --- | --- |
| **Peter McKinnon** | 白底，居中打字机字体 wordmark，极小大写导航（People / Places / Things / Clients / About / Connect / Shop）；首页是**贴边 4 列近方形马赛克**，混排所有题材 | 这是"Instagram 网格搬上网页"。扫得快，但每张图都小、都被裁方。只适合题材杂、靠人设的账号 |
| **Benjamin Hardman**（冰岛） | 白底，粗压缩体 wordmark，大写导航（Courses / Prints / Expeditions / About / Contact），全幅轮播 hero | 干净的商业模板。导航里 3 项是卖东西的 |
| **Chris Burkard** | 黑底，左侧巨大压缩体竖排导航（PORTFOLIO / SHOP / ABOUT / FILM），右侧粉色相框里一段视频；Portfolio 页白底，面包屑，"Stills" 下全宽大图 | 品牌先于照片，是经营到一定规模后的形态。全宽大图的 portfolio 内页本身不错 |
| **Max Rive** | 首页是"Framed Prints · Start Shopping"的轮播 + Wall Art / Home Decor 分类导航，往下才是作品瀑布流 | 本质是打印商店（Pixels 一类模板）。不是设计参考，是商业模式参考：风光摄影师的站普遍 shop 优先 |
| **Daniel Kordan** | 全幅 hero，导航被 2025 / 2026 / 2027 workshops 占满 | workshop 生意的站，不取 |
| **Ansel Adams Gallery** | 深色导航 + 全幅黑白 hero，"Explore Photographs / Shop / Visit Us"，进站弹优惠 | 画廊商店。黑白大图上深色 chrome 很顺，可作夜景深色主题的参考 |
| Sebastião Salgado | 原域名 amazonasimages.com 已经不是他的站（被改成营销博客），没有找到可看的官方站 | 略 |

这一类的共同点：**全幅 hero + 卖课 / 卖印 / 卖团的导航**。对我们只有两点可取：全幅大图的内页，以及"把 presets 做成一个外链商店页"这种做法是行业常态，不丢人。

## 3. AI 时代的高水准前端

看这类站不是为了抄视觉，而是学它们的**排版纪律**：一套字、两三个中性色、大留白、没有装饰性 chrome、动效只做微交互。

| 站 | 观察 |
| --- | --- |
| **Linear** | 纯黑底；大号紧字距无衬线标题，次级文案用中灰；产品截图放在一张卡片里；导航 5 项 + 两个按钮 |
| **Vercel** | 黑白两色，Geist 一套字走天下；居中一个物件，下面一排 logo；没有一处渐变 |
| **Anthropic** | 暖米白底（偏 #F4F1EA），正文衬线，圆角柔和的卡片，段落留白很大；"人文"而不是"科技" |
| **Luma** | 中灰渐变底，居中一句标题 + 药丸按钮；比 Linear 柔，比 Anthropic 冷 |
| **rauno.me**（前端 craft 个人站） | 浅灰底上一张白卡，内容在卡里；交互细节（光标、过渡）是重点 |

抽出来的规则，直接变成我们的设计约束：

1. **一套字体**。要么一款无衬线（Inter / Geist / Söhne 一类）包揽，要么无衬线 UI + 衬线正文（Anthropic 式）。不出现第三种。字体自托管，不拉 Google Fonts。
2. **三个色**：底色、正文色、弱化色。强调色只给链接 hover。照片是唯一的颜色来源。
3. **chrome 退到最小**：导航 ≤ 4 项，页脚一行，没有 hero 文案、没有横幅、没有 cookie 条、没有社交图标墙。
4. **留白按比例而不是按像素**：图与图之间、图与边之间的间距随视口缩放（`clamp()`），手机上也不贴边。
5. **动效只在交互处**：灯箱开合、图片淡入、hover 显示 caption。不做滚动视差，不做入场动画。
6. **性能是设计的一部分**：LCP 的那张图不 lazy，其余 lazy；`srcset` 四档；大陆慢链路上先出文字和版式，再出图。

## 4. 三个候选方向与推荐

### A. 档案型（Yasui / Kawauchi / Kander）

- 米白或纯白底，小号排版，首页是系列列表（封面 + 标题 + 年份 + 张数），系列页单列大图纵向排，每张下方一行弱化的 caption（地点 · 年份 · 可选相机 / 镜头）。
- 适合：系列会不断增加、题材以城市为主、希望十年后看还不过时。
- 风险：白底对夜景不友好；"太安静"，和 Instagram 上的观感有落差。

### B. 夜景型（Liam Wong）

- 近黑底，两列大图瀑布流，几乎无缝，颜色自己说话。
- 适合：tokyo-night、shinjuku、lights、shanghai-ii 这类。
- 风险：白天的系列（sanfrancisco-sunset、pacifica、aviation）在黑底上发灰；整站黑底在手机户外阅读差。

### C. 网格型（McKinnon / Instagram）

- 贴边马赛克，所有系列混排，靠 wordmark 和人设撑。
- 适合：题材杂、更新频繁、把网站当 Instagram 镜像。
- 风险：每张图都小，正是现站的毛病；需要大量裁方。

### 推荐：A 为底，B 作为"系列级别的色调"

- 全站用 A 的骨架和第 3 节的六条纪律。
- manifest 里每个系列带一个 `tone: light | dark`（AfterFrame 侧不用知道，这是发布仓库 `content/galleries.yaml` 里的字段）。夜景系列进到页面时整页切到深色底，包括导航和 caption 颜色；离开恢复。这样 tokyo-night 得到 Liam Wong 的观感，sanfrancisco 得到 Yasui 的观感，首页统一是浅色。
- 系列页默认**单列**（手机和桌面一致，桌面上图最大高 88vh、最大宽 1400 px）；竖图并排两张（AfterFrame 的 `display_shape` 已经能告诉我们横竖）。不做瀑布流，瀑布流会打乱顺序而我们是按拍摄时间讲故事的。
- 首页：wordmark 一行 + 系列封面 3 列（手机 1 列）+ 每个封面下"标题 · 年份 · N 张"。再加一个"Recent"页按时间倒序放最近发布的 60 张，给常客看。
- 灯箱：点击进全屏，键盘左右 / Esc，预加载相邻两张，右下角弱化显示 EXIF。
- 导航 4 项：Work（首页）/ Recent / Presets（外链商店或下线）/ About（含联系方式和 Instagram）。
- 字体：先用一款无衬线（Inter 自托管，中文回落系统字体）。衬线正文留到有 about 长文时再决定。

### 下一步

1. 用现站的真实照片做一个 HTML 原型（`docs/prototypes/`），把 A 的首页、一个浅色系列页、一个深色系列页、灯箱四个状态做出来，在手机和桌面上各看一遍。
2. 定了再写 Astro。原型里的间距、字号、色值直接变成 CSS 变量。

## 附：看过的 URL

liamwong.com · alecsoth.com · nadavkander.com · michaelkenna.com · greggirard.com · rinkokawauchi.com · saulleiterfoundation.org · fanho-forgetmenot.com · magnumphotos.com/photographer/alex-webb · takashiyasui.com · maxrive.com · anseladams.com · chrisburkard.com · petermckinnon.com · danielkordan.com · benjaminhardman.com · linear.app · vercel.com · anthropic.com · lumalabs.ai · rauno.me · awwwards.com/websites/photography（几乎全是代理商作品，没用）· yiwang.photography。
toddhido.com、stephenshore.net、rkrkrk.co 浏览器打不开，没看。
