# 验证记录

日期：2026-09-25。

## 已执行

- npm run typecheck：通过。
- npm run build：Wrangler dry-run 通过。
- npm test：17/17 Worker + D1 集成测试通过。
- 官方 MCP SDK 客户端：initialize、tools/list、book_review、get_booking、list_reviews 和非法参数拒绝已验证。
- 并发相同 Idempotency-Key：5 个请求只创建一个预约。
- 管理认证、乐观锁、单一付款窗口、超时回队尾、ambiguous 持锁、交易号防重用、退款证据留存、测评发布事务与时间下界已覆盖。
- M1 线上：预约 POST=201、查询 GET=200、queue=200。
- M2 线上：无认证 admin=401、有认证 admin=200、reviews=200。
- 本次线上合成预约已取消；未付款、未调用卖家服务，未发布假测评。
- M3 已部署，页面可加载真实空记录；1365px 桌面、390px 手机布局均无横向溢出，复制 curl 和刷新交互通过。桌面 curl 代码块位于首屏内。

## 尚不代表完成

本地测试中付款证据为合成夹具，不能证明真实资金到账。外部账本访问、主播完整运行循环以及 M4 端到端付款/测试/发布尚未完成。cron 已部署，线上定时触发的超时回退另行观察，不通过人为伪造付款状态验证。

- 最终线上 curl：POST /bookings=201、GET /bookings/:id=200、GET /queue=200；合成预约已取消。
- 线上官方 MCP 客户端 initialize / tools/list / list_reviews 成功，四个工具可发现。
- 本地 scheduled 事件验证：过期窗口自动回 pending_payment，ambiguous 保持暂停。

## 第二轮审查回归

17 项测试通过；新增覆盖字段白名单（模拟新增私有列）、旧 schema 数据迁移、JSON 错误分类、无效状态筛选、HEAD 健康探针、账本证据声明命名、验收脚本默认只读及按精确 ID 清理、日志敏感文本排除。前置构建由 npm pretest 自动执行。

## 2026-09-26 P0 / P1 / P2 扩展验收

- npm run typecheck 通过；npm test：22/22 通过。
- 覆盖无付款发布与并发幂等、证据归属、来源约束、旧数据迁移、URL 白名单、禁止自定义 headers/body/method、重定向拒绝、16 KiB 限制、5 秒超时、无效 JSON 丢弃、嵌套截断标记、脱敏、每 subject 五次并发预算及卖家回应权限与不可修改性。
- npm run rehearse:m4 通过，10 个阶段；见 m4-rehearsal.json。仅隔离 Miniflare 模拟，真实付款、退款、外部服务调用均为 false。
- 远端 D1 迁移 0004 / 0005 已应用。两条 demo_example 通过真实白名单 GET 发布，HTTP 200，延迟分别 24 ms / 4 ms，详见 demo-reviews.json。它们不是卖家测评或真实交易证明。
- 线上 /reviews/stats：total=2，mixed=2，demo_example=2，其余为 0。
- 线上 verify-admin 默认只读：无凭据 401、有凭据 200、reviews 200，无状态修改。
- 线上官方 MCP SDK initialize、四工具发现、list_reviews 通过。
- 浏览器 1365px 桌面和 390px 手机页面均无横向溢出；手机展开两条证据后 scrollWidth=390，资金来源、结论统计、真实探测摘录和复现命令可见。
- 卖家回应仅在本地测试与隔离演练验证；未为线上示例签发卖家凭据。
- 实际采购、付款、退款和权威 ledger 联调仍未执行。探测仅限部署配置的可信公开 HTTPS GET 地址；脱敏为启发式，发布前仍须人工检查。卖家身份核验与回应凭据私下交付由主播负责。

最终 Worker 版本：311b9976-f242-41cd-bcc8-a75b2bcdd605。

## 2026-09-26 运行时探测目标与 POST 扩展

- npm run typecheck、npm test（24/24）、npm run rehearse:m4（10阶段隔离模拟）均通过。
- 新增覆盖：运行时审批认证与来源声明、精确查询串匹配、POST JSON实际传输与管理员认证隔离、POSIX shell单引号转义、4KiB请求体限制、秘密拒绝、POST并发5次预算；DNS拒绝回环、RFC1918、链路本地、共享地址、IPv6私网和IPv4映射、解析错误、审批后解析变更。
- 远端迁移0006完成；Worker版本 bda3b29c-b2be-4ff8-a0b7-7291eeb6f9fb。
- 线上白名单审批：无认证401、有认证201；POST probe=201，JSONPlaceholder /posts 返回201 observed，319ms，实际请求体匹配。官方指南明确该接口只模拟写入，不保存真实资源。未发布新测评，无真实资金动作。
- 安全边界：DNS预检不是连接IP固定；生产仅使用无origin/VPC绑定的Cloudflare Workers global fetch。来源真实性和非资金操作仍须主播审核。需自定义Accept/SSE/会话认证的完整MCP流程不在单次POSTJSON支持范围。
- ledger只读验证：Windows CLI0.1.8不支持 --help，源码用法 ledger --last N [--before txn]；本地安全存储拒绝win32。WSL Ubuntu原Node10不满足CLI>=22.18，用户目录安装官方SHA256核验的Node22.23.3，系统Node未替换。已启动浏览器登录，等待用户授权；尚未取得账本记录，付款人/收款人/金额/memo/交易ID/时间字段完整性不能确认。

## 2026-09-26 审查 #52 脱敏修复

- typecheck 与25/25测试通过。新增回归证明 description/author/recipient/zip/participants/script_url 正常值保留；正文中的 booking/probe UUID和长公开URL保留；40位无分隔串仍打码。
- 敏感键改为标准化后整键匹配，覆盖 snake_case/camelCase 的 access token、refresh token、client secret 等；值脱敏不再跨斜杠或连字符吞掉公开路径/UUID。
- room_message 来源ID收紧为 msg_ 后10位字母数字；这仅验证形状，不验证消息存在性。未把它升级为机器验证溯源。
- 补齐卖家回应与凭据签发诊断路由；wrangler配置写明公网出口依赖，不可随意添加origin/VPC私网绑定。
- 本轮不修改产品负责人创建的 host/配置及未跟踪文档，保留他人修改。
本轮 Worker 版本：f621d2cc-c9fe-4f0d-9ddb-451fab3d1927。

## 2026-09-26 主播 CLI 与 MCP 单次探测交付

- typecheck、31/31测试、10阶段隔离M4演练通过。新增 CLI 成功/失败、版本冲突不重写、凭据不回显、来源与事件顺序、静态/动态目标撤销、固定Accept、首SSE事件、分块UTF8、超限/取消覆盖。
- 远端迁移0007通过；最终 Worker 版本 088e1324-be44-4c45-a097-e82195f15306。
- 线上 verify-admin 默认只读通过（401/200/reviews200，actions空）。
- 自身/mcp tools/list探测：prb_636b305b-e1e2-4608-a55d-6aa71ed75ccc，管理接口201，目标200 observed，32ms，truncated=false；四个工具均有名称和描述，response_projection=tools_list_summary。无测评发布、真实付款或退款。
- 首次自身探测返回404；启用 global_fetch_strictly_public 后通过。采用 [Cloudflare 官方公网 Worker 间 fetch 支持](https://developers.cloudflare.com/workers/runtime-apis/fetch/)，没有增加私网/服务绑定。
- ledger-match只完成规范化fixture匹配逻辑和歧义/金额/去重测试；真实ledger登录恢复和实际字段适配仍待办。不能将fixture_evidence当作真实支付凭证。
- host/与其他人未跟踪文档保留；主播CLI独立说明见host-cli.md。

## 2026-09-26 最小自费测评与远端更新合并

- 快进合入 ed44c38，保留负责人 host/ 与 .gitignore 未提交修改。未付款预约上限2/30纳入本轮回归。
- typecheck、35项测试全部通过。新增host_purchased缺证据400、非法付款方/超额拒绝、原始采购证据不公开、幂等重试及付款/采购共享交易ID防重用；CLI帮助、采购dry-run拒绝场景通过。
- 0008远端迁移完成；Worker 97ac20e5-c22e-4d00-8cde-9a3831792f97。线上只读admin=401/200/reviews200、MCP初始化/四工具发现/list_reviews通过。
- WSL真实只读ledger已成功，0条记录，match=none。非空交易字段映射仍未核实，返回unparseable。真实采购、付款、退款均未执行。
- 已按房间#102删除旧purchase.mjs离线规划及其专属测试。
- 第二轮彩排未由本轮重跑或验收；supervise的原子锁/截止终止问题已反馈产品负责人。
