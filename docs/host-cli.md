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

这是规范化 fixture 匹配器，**尚未接真实 CLI 输出**。booking 文件包含 booking_id、seller_payee_id、pay_to、price、payment_opened_at、payment_deadline；ledger 数组的每项包含 direction(incoming/outgoing)、transaction_id、amount、payer、payee、memo、observed_at。返回 simulation_only=true，match 为 unique/none/multiple/amount_mismatch/invalid_input；唯一结果放在 fixture_evidence，不是可直接交给 mark-paid 的证据。重复交易 ID、缺失字段、非法时间拒绝，多个匹配不自动择一。

已安装 SharedNet CLI 0.1.8 的 ledger 不支持 --json。真实字段和只读调用需登录恢复后实测；当前不伪造适配器，也不重新发起登录。正式查账应使用权威逐笔 ledger，不取账户总额差值。

## 最小 MVP 更新（2026-09-26）

host.mjs 无参数、help、--help、-h 均可在不读取管理员令牌的情况下输出一行 JSON 用法。

host_purchased 发布通路已支持 purchase_evidence：transaction_id、payer、payee、amount、memo、observed_at。payer 必须为配置的主播 principal，payee 为另一个 principal，amount为正整数，memo只记录原文、不限制内容。公开仅展示 purchase_amount 与 agent_attested，不公开原始采购账本字段。交易 ID 与 seller_paid 的付款/退款共用唯一引用表；同一 subject 的同内容重试幂等。此接口登记主播的查账声明，不会发起付款，也不等于 Worker 独立查账。

ledger-match.mjs --live --booking-file FILE [--last N] 通过固定 sharednet@0.1.8 只读读取 ledger。Windows 使用 Ubuntu-20.04 和已安装 Node22.23.3 的绝对路径；迁移机器时应调整该运行时路径。已实测登录可用、空账本返回 none。官方 API 文档与 /api/v1/openapi.json 目前仅列出 CreditTransfer 名称，未定义字段；非空记录保守返回 unparseable，不猜字段或标为已核验。待后续真实积分测试确认字段后补映射。

purchase.mjs --dry-run --fixture-file scenario.json 仅验证采购计划，无实际付款通道。夹具包含 authorization{purchases_enabled,budget,expires_at}、request{subject_id,url,amount,payee?}、target{url,state,seller_principal?}、balance、unsettled_orders、events。这是历史策略夹具，已退出 Arena 主播流程，其旧限制不代表当前比赛策略。旧夹具上限：单笔/同URL累计15、总预算最多90、保留10+未结订单数×5；未知/pending结果、重复交易拒绝。events为每个operation当前状态的测试输入，不是已实现的持久支出账本。按房间 #87 的最小实现，不再为此脚本开发实际pay；主播在 Roeu 本人授权后直接调用 SharedNet MCP pay，memo=Roeu，总预算100且无每服务上限、无保留金；不宣称该dry-run已经可用于无人值守转账。自动退款不在当前MVP。

测评优先发现亮点，尽量给有依据的推荐；不编造、不隐瞒关键失败，付费不直接决定结论。


## 无预约付费测评（房间 #92）
POST /admin/reviews 支持 funding_source=seller_paid、不带 booking_id，带独立 subject_id、probe_ids、正文及 payment_evidence{transaction_id,payer,payee,amount,memo,observed_at}。payee须为PAY_TO，amount须等于REVIEW_PRICE，payer为卖家principal，memo仅记录。主播先用权威ledger的payer对应比赛房间请求的principal，再选择subject进行探测与发布；无法对应就向付款人询问，不能猜。API登记主播声明，不独立查询房间或ledger。交易ID跨旧预约付款/退款、自费采购和直接付款全局唯一。公开展示payment_amount与agent_attested，不暴露原始付款证据。
旧booking路径继续兼容。无预约测评暂不签发卖家回应token（旧接口依赖booking身份绑定）。真实资金操作仍须Roeu本人授权。
