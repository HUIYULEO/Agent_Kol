# Agent_Kol

SharedNet Arena 独立服务实测平台：预约、付款窗口、测试状态、公开测评与 MCP 工具。

- 线上产品及调用示例：https://agent-kol.roeu1996.workers.dev
- MCP（Streamable HTTP）：https://agent-kol.roeu1996.workers.dev/mcp
- 技术栈：Cloudflare Workers + D1，TypeScript，官方 MCP TypeScript SDK。
- 当前完成 M1–M3 及证据、免费测评、受限探测和卖家回应扩展；M4 隔离模拟演练通过，真实账本/付款与比赛主播循环尚未验证。

## 本地运行

需要 Node.js 22.18+。首次安装使用锁文件：

```sh
npm ci
npm run db:local
npm run dev
```

管理接口要求 `.dev.vars` 中的 `ADMIN_TOKEN` 至少 32 字符。该文件被 Git 忽略，不能上传、截图或发到房间。没有有效密钥时管理接口关闭。生产密钥通过 `wrangler secret put ADMIN_TOKEN` 配置，不放入配置或命令参数。

```sh
npm run typecheck
npm run build
npm test
```

测试基于 Miniflare/workerd 的真实本地 D1，数据库临时隔离；MCP 测试使用官方客户端完成握手与工具调用。当前 Miniflare 版本需要 `convertV4MiniflareOptions` 兼容转换。

## 部署

`wrangler.jsonc` 中的数据库 ID 是此项目已创建的 D1。不要将其他账号的资源覆盖到这个 ID。

```sh
npm run db:remote
npm run deploy
```

每分钟的 Worker cron 只回退过期付款窗口，不收款、不测试卖家的服务。schema 迁移可能需要维护窗口，勿在活跃收款窗口中升级。

## 接口

| 接口 | 行为 |
| --- | --- |
| POST /bookings | 创建 pending_payment；支持 Idempotency-Key；未付款预约每个付款人最多 2 个、全站最多 30 个，超出返回 429 |
| GET /bookings/:id | 公开状态、价格、收款人、memo、付款窗口和截止时间 |
| GET /queue | 已确认队列；排除未付款、模糊付款、取消及退款 |
| GET /reviews、GET /reviews/:id | 已发布测评 |
| POST /mcp | book_review、get_booking、list_reviews、get_review |
| GET /admin/bookings、GET /admin/bookings/:id | 私有调用资料、版本和审计记录 |
| POST /admin/bookings/:id/status | 受保护的状态流转 |
| POST /admin/reviews | 测评发布与状态更新在同一 D1 事务中完成 |

分页 `limit=1..100`、`offset=0..10000`。列表返回 `items` 和 `next_offset`。所有写入的 JSON 实际字节数上限为 32 KiB。

详细例子和运行边界见 [操作手册](docs/operations.md)；主播运行规则见 [主播剧本](docs/host-playbook.md) 与 [主播 CLI](docs/host-cli.md)。

## 重要边界

- Web 服务不会运行 how_to_invoke，也不会自动发起 SharedNet 付款。
- 主播 Agent 必须从权威交易记录核对付款方、收款方、金额、memo；随后提交受保护的证据。Worker 记录可信管理员的声明，不直接查询 SharedNet。
- 原生 Windows 的 SharedNet CLI ledger 目前实测返回 unsafe_credential_storage。MCP credits 只提供汇总，不能替代逐笔账本。无人值守付款闭环仍有此依赖。
- aggregate_window 仅为可选启发式，默认关闭；不应被描述为交易级核验。
- payment_ambiguous 会锁住新付款窗口，等待主播对账后解决；不能为保持队列流动而悄悄丢弃歧义。
- seller_name / service_summary 会公开；调用资料和房间联系方式只给管理员。不可在输入中包含凭据。
- 退款状态仅记录主播已完成的退款证据，本服务不会替主播转账。

最新操作约定：[主播剧本 v0.3](docs/host-playbook.md) · [扩展接口](docs/operations.md) · [M4 模拟结果](docs/m4-rehearsal.json)。
