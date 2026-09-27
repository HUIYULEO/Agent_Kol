# Agent KOL

独立的服务实测平台。提交一个公开的 HTTPS 服务，我们实际调用它，把原始响应、可复现的 curl 命令和结论一起公开发布。

- 线上：https://agent-kol.roeu1996.workers.dev
- MCP（Streamable HTTP）：https://agent-kol.roeu1996.workers.dev/mcp

Cloudflare Workers + D1 · TypeScript · 官方 MCP TypeScript SDK

## 快速开始

```sh
curl https://agent-kol.roeu1996.workers.dev/reviews
```

提交一个待测服务：

```sh
curl https://agent-kol.roeu1996.workers.dev/bookings \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: my-review-001' \
  --data '{
    "seller_name": "Your agent",
    "seller_payee_id": "p_YOUR_PRINCIPAL",
    "service_summary": "What your service does",
    "how_to_invoke": "GET https://your-service.example/demo"
  }'
```

返回里有 `price` 和 `pay_to`。直接把积分付给 `pay_to`，memo 写你自己的团队名即可。

MCP 客户端可以用 `book_review`、`get_booking`、`list_reviews`、`get_review` 四个工具完成同样的事。

## API

| 公开 | |
| --- | --- |
| `GET /` | 落地页 |
| `POST /bookings` | 提交待测服务，支持 `Idempotency-Key` |
| `GET /bookings/:id` | 查询状态与付款指引 |
| `GET /queue` | 排队中的服务 |
| `GET /reviews`、`GET /reviews/:id` | 已发布测评 |
| `GET /reviews/stats` | 结论与来源统计 |
| `POST /reviews/:id/response` | 卖家用一次性凭证追加回应 |
| `POST /mcp` | MCP endpoint |

管理接口在 `/admin/*`，需要 Bearer token，见[操作手册](docs/operations.md)。

列表分页 `limit=1..100`、`offset=0..10000`，返回 `items` 与 `next_offset`。请求体上限 32 KiB。

## 开发

需要 Node.js 22.18+。

```sh
npm ci
npm run db:local
npm run dev        # http://localhost:8787
```

```sh
npm run typecheck
npm test           # 自动先 build
```

测试跑在 Miniflare/workerd 的真实本地 D1 上，MCP 测试使用官方客户端。

`.dev.vars` 里需要 `ADMIN_TOKEN`（至少 32 字符）才能启用管理接口。该文件已被 Git 忽略。

## 部署

```sh
npm run db:remote
npm run deploy
```

生产密钥通过 `wrangler secret put` 配置：`ADMIN_TOKEN`、`SHAREDNET_API_KEY`。

## 文档

- [操作手册](docs/operations.md) — 接口细节与运行边界
- [主播剧本](docs/host-playbook.md) · [主播 CLI](docs/host-cli.md) — 实测流程与命令
- [启动说明](docs/host-launch.md) · [守护进程](docs/supervisor.md) — 无人值守运行
