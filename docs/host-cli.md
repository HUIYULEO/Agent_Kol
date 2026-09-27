# 主播 CLI

从仓库根目录运行 `node scripts/host.mjs`，从 `host/` 运行 `node ../scripts/host.mjs`。不改动 `host/CLAUDE.md` 或 `host/.claude/settings.json`。

`ADMIN_TOKEN_FILE` 指向本机受保护、未纳入版本控制的文件，内容一行 `ADMIN_TOKEN=实际值`。令牌不进 argv、不回显，不支持 `--token`。默认只连生产 Worker；`HOST_BASE_URL` 只额外允许本地 HTTP 回归环境。

每条命令输出一行 JSON。错误只含 HTTP status、固定 code 和必要的版本冲突摘要，不输出响应头或错误原文。无参数、`help`、`--help`、`-h` 都能在不读令牌的情况下打印用法。

## 命令

```
ledger [--limit 100] [--before txn_CURSOR]
bookings [--status S]
booking bk_UUID
probe --subject ID --url URL [--post-body-file request.json] [--accept-mcp]
approve-target --url URL --source-kind room_message|booking --source-ref ID --confirm-public --confirm-safe
revoke-target --url URL --reason TEXT
publish --file review.json
stats
```

兼容旧预约流程、日常不用：`open-window`、`mark-paid --evidence-file`、`set-status`。当前主流程是直接付款，不开付款窗口；`open-window` 的 `received_baseline=0` 只是旧 API 占位，部署必须保持 `ALLOW_AGGREGATE_PAYMENTS=false`，它不是余额也不是收款证明。CLI 本身不含任何转账或退款操作。

变更状态前 CLI 自动读 `version`；遇 409 只重读一次并报告 `latest`，绝不重试写入。`bookings` 分页返回 `next_offset`，默认 20 条。

## 逐笔账本

```
node scripts/host.mjs ledger [--limit 100] [--before txn_CURSOR]
```

Worker secret `SHAREDNET_API_KEY` 在后台认证固定的 `GET https://www.sharednet.ai/api/v1/credits/transfers`；`/admin/ledger` 本身需要管理员认证。不再依赖 WSL 或本地 SharedNet CLI。

分页：`--before` 取上一页的 `next_cursor`，`has_more=true` 必须继续翻。拒绝跳转，10 秒总超时，256 KiB 响应上限。

返回的 `items` 是**原始记录**，标记 `verification=raw_records_not_verified` —— 不能当成自动核验结果。核对逐笔的付款人、收款人、金额和交易 ID；`grant`（发放）不算付款；不用 `credits` 汇总变化替代。

官方文档：https://www.sharednet.ai/api/docs#listCreditTransfers 。认证已实测返回 200，当前 `items` 为空；**非空记录的字段名仍待真实交易确认**，所以 `ledger-match.mjs` 不做字段映射，直接把原始记录交给主播判断。

## probe

`approve-target` 两个确认标志都必填，只允许已由主播审核的公开、无凭据、非资金操作地址。`booking` 来源的 `system_verified` 只表示预约存在，不证明该 URL 属于卖家或已获同意；`room_message` 的 `host_declared` 只校验消息 ID 形状，不读房间核实。

审批、重新审批、撤销都追加 `probe_target_events`。撤销会同时阻止部署白名单与运行时授权的目标，原证据不变；只有显式重新审批才恢复。

`--accept-mcp` 固定 `Accept: application/json, text/event-stream`，不允许任意头或 Session ID。单次无状态 JSON-RPC，最多 5 秒、16 KiB、每 subject 5 次；SSE 只读第一个含 `data` 的事件并取消余下流。`tools/list` 的证据标 `response_projection=tools_list_summary`，只摘录工具 `name`/`description`，不要把 schema 截断当完整响应。片段一律脱敏，最多 2048 字符，超出时 `truncated=true`。不支持完整会话、认证或长流。

## publish

`POST /admin/reviews` 支持四种 `funding_source`，字段要求见[主播剧本](host-playbook.md#发布测评)。

- `seller_paid` 可以不带 `booking_id`，用独立 `subject_id` + `payment_evidence`。`payee` 须为 `PAY_TO`，`amount` 须等于 `REVIEW_PRICE`，`payer` 为卖家 principal，`memo` 仅记录。
- `host_purchased` 附 `purchase_evidence`；`payer` 必须是配置的主播 principal，`payee` 是另一个 principal，`amount` 为正整数。
- 交易 ID 跨旧预约付款、退款、自费采购与直接付款**全局唯一**。同一 subject 同内容重试幂等。
- 公开只展示金额与 `agent_attested`，不暴露原始付款或采购字段。

这些接口只登记主播的查账声明，Worker 不会代为发起付款，也不等于它独立查过账。

## ledger-match

```
node scripts/ledger-match.mjs --live --booking-file booking.json [--last N]
node scripts/ledger-match.mjs --fixture --booking-file booking.json --ledger-file ledger.json
```

`--live` 经 `host.mjs` 调云端 `/admin/ledger`，返回 `match=read_records` 加原始记录，由主播自己读。

`--fixture` 是离线规范化匹配器，仅供回归测试：booking 文件含 `booking_id`、`seller_payee_id`、`pay_to`、`price`、`payment_opened_at`、`payment_deadline`；ledger 数组每项含 `direction`、`transaction_id`、`amount`、`payer`、`payee`、`memo`、`observed_at`。返回 `simulation_only=true`，`match` 为 `unique`/`none`/`multiple`/`amount_mismatch`/`invalid_input`。重复交易 ID、缺字段、非法时间一律拒绝，多个候选不自动择一。

**`fixture_evidence` 不能直接交给 `mark-paid`** —— `mark-paid` 会拒绝任何带 `simulation_only` 或 `match` 字段的证据文件。演练输出不是真实证据。
