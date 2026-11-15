/**
 * GitHub 采集层统一出口。
 * 只做 re-export，不含逻辑；消费方（sync.ts / API 路由）只从这里 import。
 */

export * from './client';
export { fetchRepoBasics } from './collectors/repo';
export { fetchTraffic } from './collectors/traffic';
export { fetchActivity } from './collectors/activity';
export { fetchIssuesAndPrs } from './collectors/issues';
export { fetchOverview } from './collectors/overview';
export {
  DEVICE_FLOW_SCOPES,
  GithubOAuthError,
  deviceFlowAvailable,
  getOAuthClientId,
  pollDeviceFlow,
  startDeviceFlow,
} from './oauth';
export type { DeviceCodeResult, PollResult } from './oauth';
export type * from './types';
