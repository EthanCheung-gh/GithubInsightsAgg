# docs 索引

本目录存放设计与工程契约文档。**代码实现以契约为准**：契约里写明的类型、路由、表结构、指标口径不得在实现中自行改动。

| 文件 | 用途 |
| --- | --- |
| [`PLAN.md`](./PLAN.md) | 实施计划：项目定位、与 GitHub 原生 Insights 的差异、技术决策与理由、数据采集矩阵、页面结构、分期与工作包、验收标准、已知边界 |
| [`CONTRACTS.md`](./CONTRACTS.md) | 工程契约（唯一事实来源）：技术栈版本、环境变量、文件写权限边界、`db/schema.sql` 全文、共享 TypeScript 类型、HTTP API 契约、设计令牌、UI / 图表 / 格式化组件 API、派生指标口径、洞察规则、Next.js 16 注意事项、命令清单 |
| [`CONTRACTS-ADDENDUM.md`](./CONTRACTS-ADDENDUM.md) | 契约增补 v1.1（优先级高于 `CONTRACTS.md` 中的冲突描述）：演示数据由采集管道写入真实表、`bootstrap.ts` 幂等自举语义、`demo.ts` 确定性合成数据要求、`tokenSource` 语义、GitHub 采集口径补充、新增依赖白名单 |

阅读顺序建议：`PLAN.md`（为什么做、做什么）→ `CONTRACTS.md`（怎么接）→ `CONTRACTS-ADDENDUM.md`（唯一的修正项）。

安装、配置、脚本与页面说明见仓库根目录的 [`README.md`](../README.md)。
