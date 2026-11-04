# @local/dsh-context-recom-hider

隐藏 **dsh-context** 在会话「上下文」标签页顶部绘制的「**感谢**」推荐卡（DeepSeek 开放平台推广位），**不修改 dsh-context 插件本体**。

## 为什么需要它

那张卡是 dsh-context 的 `Xf` 组件渲染的 `<a class="lc-card lc-recom">`：

- 它画在 `conversation.view` 那个 tab 的 **React 树内部**，不是一个独立 slot —— 所以别的插件无法用 `ctx.slots.register` 顶掉它。
- dsh-context 的 `Config` schema 里 **没有任何** 隐藏该卡的开关（`maxRequestSteps`/`maxKeptTurns`/… 全是上下文管理参数）。
- 卡片数据来自宿主 `POST api/dsh-context/recom`，请求失败会回退到内置常量 `Bf`（就是那张 DeepSeek 卡），所以**断网或改接口都挡不住**它。
- DSH 宿主**没有**通用的用户自定义 CSS 注入机制（`app.asar` 全量搜 `customCss`/`userStyleSheet`/`injectCss` 只命中终端主题那一处），所以也没有「写个样式文件就行」的官方口子。

剩下的可行路径只有一条：**插件外部接管 DOM**。本插件就是干这个的。

## 它做了什么

1. 往 `<head>` 注入一张自己拥有的样式表（`#dsh-context-recom-hider:style`，`data-plugin-css="dsh-context-recom-hider/recom.css"`），用 `!important` 把 `.lc-recom` 收成 0 尺寸。
2. 起一个 `MutationObserver`（观察 `document.documentElement`，`childList+subtree`）—— React 每次重建卡片时，给新节点补一条内联 `display:none !important` 并打上 `data-dsh-recom-hider` 标记。
3. 3 秒兜底扫描，覆盖 bfcache 恢复等 observer 抓不到的情况。
4. `apply()` 返回 cleanup：断 observer、清 timer、**移除标记并还原卡片**、删样式表。所以停用 bundle 后推荐卡会自己回来，不用重装。

只针对 `.lc-recom` 这一个类，**不碰**同列里另一张 `.lc-card`（dsh-context 版本信息卡）。

## 安装 / 停用

```bash
# 安装（在 profile 目录）
cd "C:/Users/15940/.dsh/profiles/desktop"
# package.json 的 dependencies 加 link，dsh.profile.bundles 加条目，然后：
NODE="C:/Users/15940/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node.exe"
PNPM="C:/Users/15940/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/pnpm/bin/pnpm.cjs"
"$NODE" "$PNPM" install
```

**客户端插件在桌面端启动时打包，改完/装完必须重启 DSH 桌面端才生效。**

停用：从 `dsh.profile.bundles` 删掉 `"@local/dsh-context-recom-hider"`（以及 dependencies 里的 `link:` 行），重启即可，推荐卡恢复。

## 离线自测

```bash
export PATH="/c/Users/15940/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin:$PATH"
node --check client.js && node --check index.js && node --check selftest.mjs
node selftest.mjs      # ALL CHECKS PASSED (26 passed)
```

`selftest.mjs` 用自建 DOM 桩跑真实的 `client.js`：断言样式表注入、卡片被隐藏、兄弟卡未受影响、observer 能抓住重渲染、interval 能抓住晚到节点、cleanup 能完整还原；末尾另跑一组**没有插件**的负向对照，证明这些断言不是恒真。

## 验证记录（2026-11-04）

不只是「看起来对」，以下每条都在真环境里跑过：

| 验证 | 方法 | 结果 |
|---|---|---|
| 组合配置真的接上了 | `dsh --dump-config` 于 profile 副本（`cordis.yml` 空列表 + junction `node_modules`） | `- id: dsh-context-recom-hider / name: '@local/dsh-context-recom-hider'` 出现在第 2062 行，**唯一一条**，无重复 id |
| 客户端半能被发现 | 读 profile 里软链后的 `package.json` | `dsh.client={platform:'web',immediately:true}`、`exports['./client']='./client.js'`（5152 字节，实存）、`dsh.bundle.patch` 实存；`realpath` 指回 `Documents/dsh-plugins/dsh-context-recom-hider` |
| 真浏览器里真 `client.js` 生效 | headless Chrome 载入**未改动的** `client.js`（自建 `__ModuleLoader__` 垫片），配 dsh-context 真实 CSS | 13 项全 PASS：apply 后卡 `display:none` / 高 0 / 无 client rect / 带标记；兄弟卡 86px 完好；React 重建的两张新卡都被 observer 抓住；dispose 后卡恢复 110px、样式表移除 |
| 层叠顺序无关 | 两栏对照：一栏把 dsh-context CSS 追加到插件 CSS **之后**（最坏情况） | 两栏都 `display:none`，兄弟卡都 67px —— 因为我们用 `!important` 而 dsh-context 的 recom/base 样式表 `!important` 出现 0 次 |
| 不会误伤别处 | `node_modules` 全量 grep `lc-recom` | 只有 `dsh-context/lib/client.js` 一个文件命中 |
| 负向对照真红 | 换成什么都不做的 `client.js` 重跑同一份 selftest | **15 FAILED / 26**，exit 1（不是空跑通过） |
| 静态自检 | `node --check` ×3 + `ctx.<service>` 裸读扫描 | 三个文件全过；唯一的 `ctx.` 命中在注释里，代码零裸读、`inject: []` |

浏览器实测的原始报告（`display` / `offsetHeight` / `getClientRects()` 均由 `getComputedStyle` 读取，非目测）：

```
apply 前 recom: block / 357px / 1 rect
apply 后 recom: none  / 0px   / 0 rect   marked=true
apply 后 info : block / 86px  / 1 rect   marked=null
React 重建卡 → none / 0px
dispose 后 recom: block / 110px / 1 rect  marked=null
```

## 已知边界

- 依赖 dsh-context 的类名 `lc-recom`。若上游改名，样式会静默失效（不会报错、也不会误伤别处）—— 届时改 `client.js` 顶部的 `RECOM_CLASS` 常量即可。
- 只隐藏卡片本身，不改任何数据请求；dsh-context 的 `POST api/dsh-context/recom` 仍会照常发出（拿不到数据也不影响，卡片本来就不显示了）。
- **装完必须重启 DSH 桌面端**：客户端插件在启动时组合进 `clientModules` 图，当前进程里没有它。验证插件是否已在线上生效：重启后打开「上下文」标签页，卡片不再出现即成功。
