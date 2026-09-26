# 主播 CLI

从仓库根目录运行 node scripts/host.mjs；从 host/ 运行 node ../scripts/host.mjs。不改动 host/CLAUDE.md 或 host/.claude/settings.json。

ADMIN_TOKEN_FILE 必须指向本机受保护、未纳入版本控制的文件，内容为一行 ADMIN_TOKEN=实际值。令牌不放 argv、不回显，不支持 --token。默认只连接生产 Worker；HOST_BASE_URL 只额外允许本地 HTTP 回归环境。每次输出一行 JSON；错误只含 HTTP status、固定 code 和必要的版本冲突摘要，不输出响应头或错误原文。

## 命令

- bookings [--status S]
- booking bk_UUID
- open-window bk_UUID
- mark-paid bk_UUID --evidence-file evidence.json
- set-status bk_UUID testing|failed|cancelled|payment_ambiguous|pending_payment [--reason TEXT]
- approve-target --url URL --source-kind room_message|booking --source-ref ID --confirm-public --confirm-safe
- revoke-target --url URL --reason TEXT
- probe --subject ID --url URL [--post-body-file request.json] [--accept-mcp]
- publish --file review.json
- stats

bookings 返回分页结果及 next_offset，默认第一页20条；更多历史可使用现有管理 API。变更状态前 CLI 自动读取 version；409 后只重新读取一次并报告 latest，绝不重试写入。open-window 的 received_baseline=0 是兼容旧 API 的占位，部署必须保持 ALLOW_AGGREGATE_PAYMENTS=false，它不是账本余额或收款证明。CLI 不包含转账/退款操作。

mark-paid 接受真实核验后的 ledger_attested 单条证据文件：method、transaction_id、amount、payer、payee、memo、observed_at。Worker 验证字段匹配和去重，不能独立访问权威 ledger；这仍是主播查账声明。不得从总额变化推断，演练输出不可作为真实证据。实际采购、付款、退款仍须用户本人确认。

approve-target 两个确认标志均必填，仅允许已经由主播审核的公开无凭据、非资金操作。booking 的 system_verified 只表示预约存在，不证明该 URL 属于卖家或已获卖家同意；room_message 的 host_declared 只验证消息 ID 形状，不读取房间核实。审批、重新审批、撤销均追加 probe_target_events；撤销会阻止部署白名单和运行时授权目标，原证据不变。显式重新审批才能恢复。

--accept-mcp 固定 Accept: application/json, text/event-stream；不允许任意头或 Session ID。支持单次无状态 JSON-RPC，最多5秒、16KiB、每 subject 5次；SSE只读取首个含 data 的事件并取消余下流。tools/list 响应证据标记 response_projection=tools_list_summary，仅摘录工具 name/description；不将 schema 截断误当作完整响应。所有片段仍脱敏，最多2048字符，超过时 truncated=true。没有完整会话/认证/长流支持。

## ledger-match

```sh
node scripts/ledger-match.mjs --live --booking-file booking.json [--evidence-out evidence.json]
node scripts/ledger-match.mjs --check --pay-to p_PAYTO
node scripts/ledger-match.mjs --fixture --booking-file booking.json --ledger-file ledger.json
```

--live 调用本机 `sharednet --json ledger --last 100`，按 next_cursor 用 --before 翻页，直到遇到早于预约 created_at 的转账或 has_more=false；最多10页，超过返回 ledger_incomplete，不猜测。booking 文件可以是预约对象，也可以直接是 `host.mjs booking` 的输出。只有 match=unique 时才写 --evidence-out，文件正好是 mark-paid 接受的 ledger_attested 七个字段，没有 simulation_only。其余结果：none、multiple、amount_mismatch、invalid_input、schema_unknown、ledger_unavailable、ledger_incomplete。退出码只在 unique 时为0。

CLI 0.1.8 实测：全局 --json 只把默认的缩进 JSON 变为单行，两者都是 JSON；ledger 返回 `{items,next_cursor,has_more}`；交易 ID 形如 txn_ 加10位字母数字。开发期账本为空，**单条转账的字段名尚未见过**。适配器只在每个字段恰好命中一个已知名称时读取（交易ID：id/transfer_id/transaction_id；金额：amount/credits；付款方：from/from_principal_id/from_id/sender/payer；收款方：to/to_principal_id/to_id/recipient/payee；memo：memo/note，可缺省；时间：created_at/timestamp/occurred_at/at）；付款方和收款方可以是字符串、null 或含 id/principal_id 的对象。任何一条不符合都返回 schema_unknown 及该条的字段名（不含值），整次核验失败，因此字段猜错只会导致无法收款，不会错收。收入须为正整数；支出允许带符号。原生 Windows 直接返回 run_in_wsl。

--check 读取最近20条，只报告 empty、recognized 或 schema_unknown，不做匹配。

--fixture 是规范化演练匹配器，返回 simulation_only=true，唯一结果放在 fixture_evidence，不能交给 mark-paid。
