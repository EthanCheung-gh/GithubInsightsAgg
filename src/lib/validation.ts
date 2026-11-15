import { z } from 'zod';

/**
 * API 层统一的入参校验（zod 4）。
 *
 * 约定：
 * - 所有报错文案为中文，可直接透出到前端 `detail` 字段；
 * - schema 的**输出**是规范化后的类型，路由只消费输出；
 * - 校验失败用 `safeParse` + `formatZodError()`，不要自己拼 message。
 */

/** owner / repo 单段允许的字符：字母、数字、下划线、点、连字符；长度 1~100。 */
export const OWNER_NAME_PATTERN: RegExp = /^[A-Za-z0-9_.-]{1,100}$/;

export const MIN_DAYS = 7;
export const MAX_DAYS = 90;
export const DEFAULT_DAYS = 30;

/** 一次比较 / 聚合最多可指定的仓库数（供上层 UI 与后续工作包使用）。 */
export const MAX_COMPARE_REPOS = 8;

export const MIN_LIMIT = 1;
export const MAX_LIMIT = 100;
export const DEFAULT_LIMIT = 20;

const FULL_NAME_MESSAGE = 'owner/name 只能包含字母、数字、下划线、点、连字符（长度 1~100）';
const FULL_NAME_FORMAT_MESSAGE = 'owner/name 必须是 owner/name 两段格式（例如 vercel/next.js）';
const DAYS_MESSAGE = `days 必须是 ${MIN_DAYS}~${MAX_DAYS} 的整数`;
const LIMIT_MESSAGE = `limit 必须是 ${MIN_LIMIT}~${MAX_LIMIT} 的整数`;
const BODY_OBJECT_MESSAGE = 'body 必须是 JSON 对象';
const ENABLED_MESSAGE = 'enabled 必须是布尔值 true 或 false';
const REPO_ID_MESSAGE = 'id 必须是正整数';
const REPOS_MESSAGE = 'repos 必须是逗号分隔的 owner/name 列表';

/** 把 `null` / `undefined` / 空白字符串统一折叠成 `undefined`，交给 `.default()` 兜底。 */
function emptyToUndefined(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  }
  return value;
}

/** 单段 owner / repo：trim 后按 `OWNER_NAME_PATTERN` 校验。 */
function nameSegment(label: string) {
  return z
    .string({ error: `${label} 必须是字符串` })
    .trim()
    .min(1, { error: `${label} 只能包含字母、数字、下划线、点、连字符（长度 1~100）` })
    .max(100, { error: `${label} 只能包含字母、数字、下划线、点、连字符（长度 1~100）` })
    .regex(OWNER_NAME_PATTERN, { error: `${label} 只能包含字母、数字、下划线、点、连字符（长度 1~100）` });
}

/** 返回 `owner/name` 的问题列表，空数组表示合法。 */
function fullNameProblems(value: string): string[] {
  const segments = value.split('/');
  if (segments.length !== 2) return [FULL_NAME_FORMAT_MESSAGE];
  const problems: string[] = [];
  for (const segment of segments) {
    if (!OWNER_NAME_PATTERN.test(segment)) problems.push(FULL_NAME_MESSAGE);
  }
  return problems;
}

/** `'owner/name'`：两段都必须匹配 `OWNER_NAME_PATTERN`，输出 trim 后的全名。 */
export const fullNameSchema: z.ZodType<string> = z
  .string({ error: 'owner/name 必须是字符串' })
  .trim()
  .superRefine((value, ctx) => {
    for (const message of fullNameProblems(value)) {
      ctx.addIssue({ code: 'custom', message });
    }
  });

/** `?days=` / body `days`：7~90 的整数，缺省 30。 */
export const daysQuerySchema: z.ZodType<number> = z.preprocess(
  emptyToUndefined,
  z.coerce
    .number({ error: DAYS_MESSAGE })
    .int({ error: DAYS_MESSAGE })
    .min(MIN_DAYS, { error: DAYS_MESSAGE })
    .max(MAX_DAYS, { error: DAYS_MESSAGE })
    .default(DEFAULT_DAYS),
);

/** `GET /api/sync?limit=`：1~100 的整数，缺省 20。 */
export const syncLimitSchema: z.ZodType<number> = z.preprocess(
  emptyToUndefined,
  z.coerce
    .number({ error: LIMIT_MESSAGE })
    .int({ error: LIMIT_MESSAGE })
    .min(MIN_LIMIT, { error: LIMIT_MESSAGE })
    .max(MAX_LIMIT, { error: LIMIT_MESSAGE })
    .default(DEFAULT_LIMIT),
);

/** 路径参数 `:id`：正整数（允许从字符串 coerce）。 */
export const repoIdSchema: z.ZodType<number> = z.coerce
  .number({ error: REPO_ID_MESSAGE })
  .int({ error: REPO_ID_MESSAGE })
  .positive({ error: REPO_ID_MESSAGE });

type RepoCreateInput = { fullName?: string; owner?: string; name?: string };
type Issue = { path: (string | number)[]; message: string };
type ResolvedFullName = { ok: true; fullName: string } | { ok: false; issues: Issue[] };

/** 解析 `POST /api/repos` 的两种写法：优先 `fullName`，其次 `owner` + `name`。 */
function resolveRepoCreate(value: RepoCreateInput): ResolvedFullName {
  // 与改造前的 parseAddRepoBody 语义一致：只要 fullName 是字符串就以它为准
  if (typeof value.fullName === 'string') {
    const fullName = value.fullName.trim();
    const problems = fullNameProblems(fullName);
    if (problems.length === 0) return { ok: true, fullName };
    return { ok: false, issues: problems.map((message) => ({ path: ['fullName'], message })) };
  }

  const owner = typeof value.owner === 'string' ? value.owner.trim() : null;
  const name = typeof value.name === 'string' ? value.name.trim() : null;
  if (owner === null && name === null) {
    return { ok: false, issues: [{ path: [], message: '需要提供 fullName，或同时提供 owner 与 name' }] };
  }

  const issues: Issue[] = [];
  if (owner === null) issues.push({ path: ['owner'], message: '缺少 owner（也可以直接传 fullName）' });
  else if (!OWNER_NAME_PATTERN.test(owner)) issues.push({ path: ['owner'], message: FULL_NAME_MESSAGE });
  if (name === null) issues.push({ path: ['name'], message: '缺少 name（也可以直接传 fullName）' });
  else if (!OWNER_NAME_PATTERN.test(name)) issues.push({ path: ['name'], message: FULL_NAME_MESSAGE });
  if (issues.length > 0) return { ok: false, issues };

  return { ok: true, fullName: `${owner}/${name}` };
}

/** `{ fullName }` 或 `{ owner, name }` → 统一输出 `{ fullName: 'owner/name' }`。 */
export const repoCreateSchema: z.ZodType<{ fullName: string }> = z
  .object(
    {
      fullName: z.string({ error: 'fullName 必须是字符串' }).optional(),
      owner: z.string({ error: 'owner 必须是字符串' }).optional(),
      name: z.string({ error: 'name 必须是字符串' }).optional(),
    },
    { error: BODY_OBJECT_MESSAGE },
  )
  .superRefine((value, ctx) => {
    const resolved = resolveRepoCreate(value);
    if (resolved.ok) return;
    for (const issue of resolved.issues) {
      ctx.addIssue({ code: 'custom', message: issue.message, path: issue.path });
    }
  })
  .transform((value) => {
    const resolved = resolveRepoCreate(value);
    if (!resolved.ok) {
      // superRefine 已拦住非法输入，这里只是让类型收敛
      throw new Error(resolved.issues[0]?.message ?? FULL_NAME_FORMAT_MESSAGE);
    }
    return { fullName: resolved.fullName };
  });

/** `PATCH /api/repos/:id`：`enabled` 必填且必须是布尔值（不接受 `'true'` / `1`）。 */
export const repoPatchSchema: z.ZodType<{ enabled: boolean }> = z.object(
  { enabled: z.boolean({ error: ENABLED_MESSAGE }) },
  { error: BODY_OBJECT_MESSAGE },
);

/** `POST /api/sync`：body 可省略/可空；`days` 缺省 30；`fullName` 可选。 */
export const syncRequestSchema: z.ZodType<{ fullName?: string; days: number }> = z.preprocess(
  // 与改造前一致：非对象 body（null / 数组 / 标量 / 非法 JSON）一律当空对象处理
  (value) => (value === null || typeof value !== 'object' || Array.isArray(value) ? {} : value),
  z.object(
    {
      fullName: z.preprocess(emptyToUndefined, fullNameSchema.optional()),
      days: daysQuerySchema,
    },
    { error: BODY_OBJECT_MESSAGE },
  ),
);

/** `GET /api/aggregate`：`repos` 逗号分隔；省略或空串 → `null`；非法项直接报错。 */
export const aggregateQuerySchema: z.ZodType<{ days: number; repos: string[] | null }> = z.object(
  {
    days: daysQuerySchema,
    repos: z.preprocess(
      (value) => {
        if (value === null || value === undefined) return null;
        if (typeof value !== 'string') return value;
        const trimmed = value.trim();
        return trimmed === '' ? null : trimmed.split(',').map((item) => item.trim());
      },
      z.union([z.null(), z.array(fullNameSchema, { error: REPOS_MESSAGE })], { error: REPOS_MESSAGE }),
    ),
  },
  { error: '查询参数格式错误' },
);

/** 路径参数 `:owner` / `:repo` 的两段校验。 */
export const ownerRepoSchema: z.ZodType<{ owner: string; repo: string }> = z.object(
  { owner: nameSegment('owner'), repo: nameSegment('repo') },
  { error: '路径参数格式错误' },
);

/** 设置 Token：trim 后长度 20~255，只允许 `A-Za-z0-9_`。 */
export const tokenSetSchema: z.ZodType<{ token: string }> = z.object({
  token: z
    .string({ error: 'token 必须是字符串' })
    .trim()
    .regex(/^[A-Za-z0-9_]{20,255}$/, {
      error: 'token 只能包含字母、数字、下划线，长度 20~255',
    }),
});

/** 设备码轮询：长度 8~255。 */
export const devicePollSchema: z.ZodType<{ deviceCode: string }> = z.object({
  deviceCode: z
    .string({ error: 'deviceCode 必须是字符串' })
    .min(8, { error: 'deviceCode 长度必须是 8~255' })
    .max(255, { error: 'deviceCode 长度必须是 8~255' }),
});

/**
 * 把 `ZodError` 压平成给前端看的 `detail` 字符串。
 *
 * 用 `error.issues`（`z.flattenError` 只保留顶层 path，嵌套的 `repos.1` 之类会丢），
 * 去重后按 `；` 拼接，最多 3 条；无问题时返回空串。
 */
export function formatZodError(error: z.ZodError): string {
  const messages: string[] = [];
  for (const issue of error.issues) {
    const message = issue.message.trim();
    if (message === '' || messages.includes(message)) continue;
    messages.push(message);
    if (messages.length === 3) break;
  }
  return messages.join('；');
}
