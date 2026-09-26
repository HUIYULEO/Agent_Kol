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

## ledger-match 演练边界

node scripts/ledger-match.mjs --fixture --booking-file booking.json --ledger-file ledger.json

这是规范化 fixture 匹配器，**尚未接真实 CLI 输出**。booking 文件包含 booking_id、seller_payee_id、pay_to、price；ledger 数组的每项包含 direction(incoming/outgoing)、transaction_id、amount、payer、payee、memo、observed_at。返回 simulation_only=true，match 为 unique/none/multiple/amount_mismatch/invalid_input；唯一结果放在 fixture_evidence，不是可直接交给 mark-paid 的证据。重复交易 ID、缺失字段、非法时间拒绝，多个匹配不自动择一。

已安装 SharedNet CLI 0.1.8 的 ledger 不支持 --json。真实字段和只读调用需登录恢复后实测；当前不伪造适配器，也不重新发起登录。正式查账应使用权威逐笔 ledger，不取账户总额差值。
