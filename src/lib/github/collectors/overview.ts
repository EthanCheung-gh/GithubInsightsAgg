import { rest } from '../client';
import type {
  CommunityProfileInput,
  CommunityProfileResponse,
  OverviewResult,
  ReleaseItem,
} from '../types';

const RELEASE_PAGE_SIZE = 30;

function enc(value: string): string {
  return encodeURIComponent(value);
}

function toInt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0;
}

function hasFile(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return value !== null && value !== undefined && value !== false;
}

/**
 * 概览三件套：语言构成、Release 列表、社区健康档案。
 * - `/languages` 与 `/releases` **不加 allow404**：非 2xx（403/404/5xx）直接抛错，
 *   由 sync.ts 记为失败且不写库——否则空数组会把历史语言构成 / Release 列表清空。
 *   200 + `{}` / `[]` 才是「确实没有」，此时允许覆盖。
 * - `/community/profile` 的 404 语义是「仓库确实没有社区档案」→ allow404，community: null，
 *   这是唯一允许「无可写」而非「失败」的分支。
 * - `/releases` 过滤 draft（未发布的不该出现在节奏统计里）。
 */
export async function fetchOverview(
  owner: string,
  name: string,
  description: string | null,
): Promise<OverviewResult> {
  const base = `/repos/${enc(owner)}/${enc(name)}`;

  const languagesRaw = await rest<Record<string, number>>(`${base}/languages`);
  const languages = Object.entries(languagesRaw ?? {})
    .filter(([language]) => typeof language === 'string' && language.trim() !== '')
    .map(([language, bytes]) => ({ language, bytes: toInt(bytes) }))
    .sort((a, b) => b.bytes - a.bytes || a.language.localeCompare(b.language));

  const releasesRaw = await rest<ReleaseItem[]>(`${base}/releases`, {
    params: { per_page: RELEASE_PAGE_SIZE },
  });
  const releases = (releasesRaw ?? [])
    .filter((item) => item && typeof item.tag_name === 'string' && item.tag_name.trim() !== '')
    .filter((item) => item.draft !== true)
    .map((item) => ({
      tagName: String(item.tag_name),
      name: typeof item.name === 'string' && item.name.trim() !== '' ? item.name : null,
      publishedAt: typeof item.published_at === 'string' ? item.published_at : null,
      isPrerelease: item.prerelease === true,
    }))
    .sort((a, b) => {
      if (a.publishedAt === b.publishedAt) return a.tagName.localeCompare(b.tagName);
      if (a.publishedAt === null) return 1;
      if (b.publishedAt === null) return -1;
      return a.publishedAt < b.publishedAt ? 1 : -1;
    });

  const profile = await rest<CommunityProfileResponse>(`${base}/community/profile`, {
    allow404: true,
  });

  let community: CommunityProfileInput | null = null;
  if (profile) {
    const files = profile.files ?? null;
    const profileDescription =
      typeof profile.description === 'string' ? profile.description.trim() : '';
    const passedDescription = (description ?? '').trim();
    community = {
      healthPercentage: toInt(profile.health_percentage),
      hasReadme: hasFile(files?.readme),
      hasLicense: hasFile(files?.license),
      hasContributing: hasFile(files?.contributing),
      hasCodeOfConduct: hasFile(files?.code_of_conduct),
      hasIssueTemplate: hasFile(files?.issue_template),
      hasPullRequestTemplate: hasFile(files?.pull_request_template),
      hasDescription: (profileDescription || passedDescription).length > 0,
    };
  }

  return { languages, releases, community };
}
