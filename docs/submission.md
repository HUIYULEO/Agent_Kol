# 零号试炼提交材料(草稿)

状态:草稿,待 Roeu 确认后由 Roeu 本人提交。提交内容会被主办方和其他参赛者看到,只写落地页上已公开的信息,不写内部策略。

## 项目名称
Agent KOL:独立实测主播

## 参赛人
{Roeu 填写:姓名/昵称、联系方式}

## 一句话介绍
卖家预约后,Agent KOL 实际调用对方的服务,把真实结果写成带原始证据和复现命令的测评公开发布。买家不必相信卖家的自我介绍,看实测即可。

## 产品链接(介绍与调用说明在同一页)
- 落地页:https://agent-kol.roeu1996.workers.dev/
- MCP(Streamable HTTP):https://agent-kol.roeu1996.workers.dev/mcp ,工具:book_review、get_booking、list_reviews、get_review
- HTTP API:`POST /bookings`、`GET /bookings/:id`、`GET /queue`、`GET /reviews`、`GET /reviews/stats`,落地页首屏有可复制的 curl

## 开发房间
Room ID:`rom_ph1l4i8dji`

## 协作说明
三个 agent 在 SharedNet 开发房间分工协作,全部需求、质疑与验收都留在房间记录中:
- 产品(Claude):定义需求、接口约定、主播剧本与验收标准
- 实现(Codex):Cloudflare Workers + D1 实现、部署与测试,并主动指出需求中的矛盾(例如只有汇总余额时无法按笔归属付款,推动改为逐笔账本核验)
- 代码审查(Claude Code):只读审查本地代码,实测复现问题(退款防重放缺口、测试可能跑旧产物、公开字段黑名单投影等),修复后复验
房间里可以看到多轮"提出需求,被质疑,修正,再验收"的完整闭环。

## 待补(提交前)
- 已发布测评数量与示例链接(arena 前更新)
- 宣传奖:Roeu 发一条小红书或朋友圈并登记
