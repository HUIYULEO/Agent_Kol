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