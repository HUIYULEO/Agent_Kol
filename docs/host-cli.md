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
node scripts/ledger-match.mjs --live --booking-file booking.json [--last N] [--evidence-out evidence.json]
node scripts/ledger-match.mjs --check --pay-to p_PAYTO
node scripts/ledger-match.mjs --fixture --booking-file booking.json --ledger-file ledger.json
```

--live 通过固定的 `npx -y sharednet@0.1.8 --json ledger --last N`（默认100）只读读取 ledger。Windows 原生无法保存凭据，因此经 `wsl.exe -d Ubuntu-20.04` 和已安装 Node22.23.3 的绝对路径运行；迁移机器时应调整该路径。按 next_cursor 用 --before 翻页，直到遇到早于预约 created_at 的转账或 has_more=false；最多10页，超过返回 unparseable/ledger_incomplete，不猜测。booking 文件可以是预约对象，也可以直接是 `host.mjs booking` 的输出。只有 match=unique 时才写 --evidence-out，文件正好是 mark-paid 接受的 ledger_attested 七个字段，没有 simulation_only。结果：unique、none、multiple、amount_mismatch、invalid_input、unparseable（附 reason）。退出码在 unique 和 none 时为0。

CLI 0.1.8 实测：全局 --json 只把默认的缩进 JSON 变为单行，两者都是 JSON；ledger 返回 `{items,next_cursor,has_more}`；交易 ID 形如 txn_ 加10位字母数字；WSL 登录可用、空账本返回 none。官方 API 文档与 /api/v1/openapi.json 只列出 CreditTransfer 名称、未定义字段，开发期账本为空，**单条转账的字段名尚未见过**。适配器只在每个字段恰好命中一个已知名称时读取（交易ID：id/transfer_id/transaction_id；金额：amount/credits；付款方：from/from_principal_id/from_id/sender/payer；收款方：to/to_principal_id/to_id/recipient/payee；memo：memo/note，可缺省；时间：created_at/timestamp/occurred_at/at）；付款方和收款方可以是字符串、null 或含 id/principal_id 的对象。任何一条不符合都返回 unparseable、reason=credit_transfer_fields_unverified 及该条的字段名（不含值），整次核验失败，因此字段猜错只会导致无法收款，不会错收。收入须为正整数；支出允许带符号。真实积分到账后，以 --check 结果确认或补映射。

--check 读取最近20条，只报告 empty、recognized 或 unparseable，不做匹配。

--fixture 是规范化演练匹配器，返回 simulation_only=true，唯一结果放在 fixture_evidence，不能交给 mark-paid。正式查账应使用权威逐笔 ledger，不取账户总额差值。

## 最小 MVP 更新（2026-09-26）

host.mjs 无参数、help、--help、-h 均可在不读取管理员令牌的情况下输出一行 JSON 用法。

host_purchased 发布通路已支持 purchase_evidence：transaction_id、payer、payee、amount、memo、observed_at。payer 必须为配置的主播 principal，payee 为另一个 principal，amount为1–15整数，memo为 purchase:subject_id。公开仅展示 purchase_amount 与 agent_attested，不公开原始采购账本字段。交易 ID 与 seller_paid 的付款/退款共用唯一引用表；同一 subject 的同内容重试幂等。此接口登记主播的查账声明，不会发起付款，也不等于 Worker 独立查账。

purchase.mjs --dry-run --fixture-file scenario.json 仅验证采购计划，无实际付款通道。夹具包含 authorization{purchases_enabled,budget,expires_at}、request{subject_id,url,amount,payee?}、target{url,state,seller_principal?}、balance、unsettled_orders、events。上限：单笔/同URL累计15、总预算最多90、保留10+未结订单数×5；未知/pending结果、重复交易拒绝。events为每个operation当前状态的测试输入，不是已实现的持久支出账本。真实启动授权文件读取、原子锁、追加支出日志及实际pay仍留到后续启用阶段；不宣称该dry-run已经可用于无人值守转账。自动退款不在当前MVP。

测评优先发现亮点，尽量给有依据的推荐；不编造、不隐瞒关键失败，付费不直接决定结论。
