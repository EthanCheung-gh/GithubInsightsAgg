'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Copy, ExternalLink, KeyRound, Loader2, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { fetchJson } from '@/lib/client-api';

/** Token 来源（与 `/api/auth/token` 的 `source` 一一对应）。 */
export type TokenSourceKind = 'env' | 'stored' | 'gh-cli' | 'none';

/** Server Component 预先算好的初始状态，组件自身不再请求 `GET /api/auth/token`。 */
export interface TokenPanelInitial {
  configured: boolean;
  source: TokenSourceKind;
  sourceLabel: string;
  maskedToken: string | null;
  canClear: boolean;
  deviceFlowAvailable: boolean;
  createTokenUrl: string;
  settingUrl: string;
}

interface DeviceStartResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

type DevicePollResponse =
  | { state: 'pending' }
  | { state: 'slow_down'; interval: number }
  | { state: 'success'; login: string; scopes: string[]; maskedToken: string; source: 'stored' }
  | { state: 'error'; error: string; description: string };

/** Device Flow 面板状态机：idle -> starting -> waiting -> success | error。 */
type DevicePhase = 'idle' | 'starting' | 'waiting' | 'success' | 'error';

const BADGE_TONE: Record<TokenSourceKind, 'good' | 'info' | 'warn'> = {
  env: 'good',
  stored: 'good',
  'gh-cli': 'info',
  none: 'warn',
};

/** 接口没给 `interval` 时的兜底轮询间隔（秒）。 */
const POLL_FALLBACK_SECONDS = 5;
/** 「已复制」文案的停留时长。 */
const COPY_RESET_MS = 2000;

function formatCountdown(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = String(Math.floor(safe / 60)).padStart(2, '0');
  const seconds = String(safe % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

/** 优先展示接口返回的 `detail`，其次 `Error.message`，最后用调用方给的兜底文案。 */
function requestDetail(error: unknown, fallback: string): string {
  if (error !== null && typeof error === 'object') {
    const payload = (error as { payload?: { detail?: unknown } | null }).payload;
    if (payload && typeof payload.detail === 'string' && payload.detail.trim() !== '') {
      return payload.detail;
    }
  }
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  return fallback;
}

/** 把 Device Flow 的 `error` 码翻成中文；未知错误回落到 GitHub 的 `description`。 */
function deviceErrorMessage(error: string, description: string): string {
  if (error === 'expired_token') return '验证码已过期，请重新生成';
  if (error === 'access_denied') return '你取消了本次授权';
  if (description.trim() !== '') return description;
  return '授权失败，请重新生成验证码后重试';
}

export function TokenPanel({ initial }: { initial: TokenPanelInitial }) {
  const router = useRouter();

  const [phase, setPhase] = useState<DevicePhase>('idle');
  const [session, setSession] = useState<DeviceStartResponse | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [successLogin, setSuccessLogin] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [popupBlocked, setPopupBlocked] = useState(false);

  const [manualToken, setManualToken] = useState('');
  const [savingManual, setSavingManual] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);
  const [manualNotice, setManualNotice] = useState<string | null>(null);

  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

  /** 倒计时 `setInterval` 句柄。 */
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** 轮询前的 `setTimeout`；`resolve()` 让取消可以立刻唤醒等待中的循环。 */
  const waitRef = useRef<{ id: ReturnType<typeof setTimeout>; resolve: () => void } | null>(null);
  /** 正在进行的轮询请求，取消/卸载时 abort，避免请求泄漏。 */
  const abortRef = useRef<AbortController | null>(null);
  /** 取消标记：轮询循环每一圈都检查，保证取消后不再 setState。 */
  const cancelRef = useRef(false);
  /** 轮次编号：每次 teardown 自增，任何旧轮询循环（含被打断的 await）都会因编号不符而退出。 */
  const runIdRef = useRef(0);
  /** 「已复制」2 秒后复位用。 */
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 复制失败时降级 `select()` 的输入框。 */
  const codeInputRef = useRef<HTMLInputElement | null>(null);

  const stopCountdown = useCallback(() => {
    if (countdownRef.current !== null) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  }, []);

  /** 停掉所有定时器与在途请求，并作废当前轮次；可重复调用。 */
  const teardownDeviceFlow = useCallback(() => {
    cancelRef.current = true;
    runIdRef.current += 1;
    if (waitRef.current !== null) waitRef.current.resolve();
    stopCountdown();
    if (abortRef.current !== null) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, [stopCountdown]);

  // 卸载（含 StrictMode 的二次挂载）时清干净定时器与请求。
  useEffect(() => {
    cancelRef.current = false;
    return () => {
      teardownDeviceFlow();
      if (copiedTimerRef.current !== null) {
        clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = null;
      }
    };
  }, [teardownDeviceFlow]);

  // 拿到验证码之后再打开授权页：避免点击 -> await 之后失去用户手势而被浏览器拦截。
  useEffect(() => {
    if (session === null) return;
    const popup = window.open(session.verificationUri, '_blank', 'noopener,noreferrer');
    setPopupBlocked(popup === null);
  }, [session]);

  // 倒计时归零 -> 直接判定过期，避免继续轮询一个已失效的 device code。
  useEffect(() => {
    if (phase !== 'waiting') return;
    if (remaining > 0) return;
    teardownDeviceFlow();
    setPhase('error');
    setDeviceError('验证码已过期，请重新生成');
  }, [phase, remaining, teardownDeviceFlow]);

  /** 可被取消打断的 sleep：取消时清掉 setTimeout 并立即 resolve。 */
  function wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const id = setTimeout(() => {
        waitRef.current = null;
        resolve();
      }, ms);
      waitRef.current = {
        id,
        resolve: () => {
          clearTimeout(id);
          waitRef.current = null;
          resolve();
        },
      };
    });
  }

  const startCountdown = useCallback(
    (seconds: number) => {
      stopCountdown();
      setRemaining(Math.max(0, Math.floor(seconds)));
      countdownRef.current = setInterval(() => {
        setRemaining((prev) => (prev > 0 ? prev - 1 : 0));
      }, 1000);
    },
    [stopCountdown],
  );

  /** 按 `interval` 秒轮询 `GET /api/auth/device`，按 `state` 分发。 */
  const runPollLoop = useCallback(
    async (current: DeviceStartResponse, runId: number) => {
      /** 本轮轮询当前使用的间隔（秒）；`slow_down` 时用服务端返回值覆盖。 */
      let intervalSeconds =
        Number.isFinite(current.interval) && current.interval > 0
          ? current.interval
          : POLL_FALLBACK_SECONDS;

      /** 本次轮询是否已被取消/被新一轮取代。 */
      const isStale = () => cancelRef.current || runIdRef.current !== runId;

      while (!isStale()) {
        await wait(intervalSeconds * 1000);
        if (isStale()) return;

        const controller = new AbortController();
        abortRef.current = controller;

        let payload: DevicePollResponse;
        try {
          // 把当前间隔回传给服务端：GitHub 的 slow_down 响应体不带 interval，
          // 只有带上当前值服务端才能返回递增后的新间隔（10 → 15 → 20 …）。
          payload = await fetchJson<DevicePollResponse>(
            `/api/auth/device?deviceCode=${encodeURIComponent(current.deviceCode)}&interval=${encodeURIComponent(String(intervalSeconds))}`,
            { signal: controller.signal },
          );
        } catch (error) {
          if (isStale()) return;
          stopCountdown();
          setPhase('error');
          setDeviceError(requestDetail(error, '轮询授权状态失败，请重试'));
          return;
        } finally {
          if (abortRef.current === controller) abortRef.current = null;
        }

        if (isStale()) return;

        if (payload.state === 'pending') continue;

        if (payload.state === 'slow_down') {
          // 用服务端返回的新间隔覆盖本地值，后续轮询按新间隔等待（下一次请求会把新值回传）。
          intervalSeconds =
            Number.isFinite(payload.interval) && payload.interval > 0
              ? payload.interval
              : intervalSeconds + 5;
          continue;
        }

        if (payload.state === 'success') {
          stopCountdown();
          setSuccessLogin(payload.login);
          setDeviceError(null);
          setPhase('success');
          router.refresh();
          return;
        }

        stopCountdown();
        setPhase('error');
        setDeviceError(deviceErrorMessage(payload.error, payload.description));
        return;
      }
    },
    [router, stopCountdown],
  );

  async function handleStartDeviceFlow() {
    if (phase === 'starting' || phase === 'waiting') return;
    teardownDeviceFlow();
    cancelRef.current = false;
    // teardown 已把轮次自增，这里取到的就是本轮编号
    const runId = runIdRef.current;
    setPhase('starting');
    setDeviceError(null);
    setSuccessLogin(null);
    setPopupBlocked(false);
    setCopied(false);

    try {
      const data = await fetchJson<DeviceStartResponse>('/api/auth/device', { method: 'POST' });
      if (cancelRef.current || runIdRef.current !== runId) return;
      setSession(data);
      startCountdown(data.expiresIn);
      setPhase('waiting');
      void runPollLoop(data, runId);
    } catch (error) {
      if (runIdRef.current !== runId) return;
      setSession(null);
      setPhase('error');
      setDeviceError(requestDetail(error, '无法启动一键授权，请改用手动填写 Token'));
    }
  }

  function handleCancelDeviceFlow() {
    teardownDeviceFlow();
    setSession(null);
    setRemaining(0);
    setPhase('idle');
    setDeviceError(null);
    setPopupBlocked(false);
  }

  async function handleCopyUserCode() {
    if (session === null) return;
    let ok = false;
    try {
      await navigator.clipboard.writeText(session.userCode);
      ok = true;
    } catch {
      // 剪贴板不可用（非 HTTPS / 权限被拒）时降级为选中文本，再尝试一次 execCommand。
      const input = codeInputRef.current;
      if (input !== null) {
        input.focus();
        input.select();
        try {
          ok = document.execCommand('copy');
        } catch {
          ok = false;
        }
      }
    }
    if (!ok) return;

    setCopied(true);
    if (copiedTimerRef.current !== null) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => {
      copiedTimerRef.current = null;
      setCopied(false);
    }, COPY_RESET_MS);
  }

  async function handleSaveManualToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = manualToken.trim();
    if (token === '') {
      setManualError('请先粘贴 Token');
      return;
    }

    setSavingManual(true);
    setManualError(null);
    setManualNotice(null);
    try {
      const data = await fetchJson<{ ok: true; login: string }>('/api/auth/token', {
        method: 'POST',
        body: JSON.stringify({ token }),
      });
      setManualToken('');
      setManualNotice(`已连接：${data.login}`);
      router.refresh();
    } catch (error) {
      setManualError(requestDetail(error, '保存失败，请稍后重试'));
    } finally {
      setSavingManual(false);
    }
  }

  async function handleClearStoredToken() {
    if (!window.confirm('确定清除应用内保存的 Token 吗？清除后会回退到 gh CLI 或演示模式。')) {
      return;
    }
    setClearing(true);
    setClearError(null);
    try {
      await fetchJson<{ ok: true }>('/api/auth/token', { method: 'DELETE' });
      router.refresh();
    } catch (error) {
      setClearError(requestDetail(error, '清除失败，请稍后重试'));
    } finally {
      setClearing(false);
    }
  }

  const manualSection = (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <a
          className="btn btn--ghost btn--sm"
          href={initial.createTokenUrl}
          target="_blank"
          rel="noreferrer"
        >
          <ExternalLink size={12} />
          去 GitHub 创建 Token
        </a>
        <a
          className="text-[12px] text-accent"
          href={initial.settingUrl}
          target="_blank"
          rel="noreferrer"
        >
          管理已有 Token
        </a>
      </div>
      <p className="text-[11px] leading-relaxed text-muted">
        已预填 <code className="tabular text-text">repo</code>、
        <code className="tabular text-text">read:org</code> 权限，权限范围别改小，否则 Traffic 采不到。
      </p>
      <form onSubmit={handleSaveManualToken} className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <input
            type="password"
            className="input tabular"
            value={manualToken}
            onChange={(event) => setManualToken(event.target.value)}
            placeholder="ghp_…"
            aria-label="手动填写的 Token"
            autoComplete="off"
            spellCheck={false}
            disabled={savingManual}
          />
          <Button type="submit" variant="primary" loading={savingManual} className="shrink-0">
            {savingManual ? null : <KeyRound size={13} />}
            保存
          </Button>
        </div>
        {manualError !== null ? (
          <p className="text-[11px] leading-relaxed text-danger">{manualError}</p>
        ) : null}
        {manualNotice !== null ? (
          <p className="text-[11px] leading-relaxed text-success">{manualNotice}</p>
        ) : null}
      </form>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {/* 1. 状态行 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <KeyRound size={14} className="text-muted" />
          <span className="text-[13px] font-medium text-text">当前 Token</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {initial.maskedToken !== null ? (
            <code className="tabular text-[12px] text-muted">{initial.maskedToken}</code>
          ) : null}
          <Badge tone={BADGE_TONE[initial.source]}>{initial.sourceLabel}</Badge>
        </div>
      </div>

      {/* 2. 一键连接（Device Flow），仅配置了 Client ID 时出现 */}
      {initial.deviceFlowAvailable ? (
        <section className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-border bg-surface-2 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[13px] font-medium text-text">一键连接 GitHub</span>
            {phase !== 'waiting' ? (
              <Button
                variant="primary"
                size="sm"
                onClick={handleStartDeviceFlow}
                loading={phase === 'starting'}
              >
                {phase === 'starting' ? null : <ExternalLink size={12} />}
                {phase === 'starting' ? '正在生成验证码…' : '一键连接 GitHub'}
              </Button>
            ) : null}
          </div>

          {phase === 'idle' ? (
            <p className="text-[12px] leading-relaxed text-muted">
              点击后会在新标签页打开 GitHub 授权页，输入下方生成的验证码即可，无需手动创建 Token。
            </p>
          ) : null}

          {phase === 'starting' ? (
            <p className="flex items-center gap-2 text-[12px] text-muted">
              <Loader2 size={12} className="animate-spin" />
              正在向 GitHub 申请验证码…
            </p>
          ) : null}

          {phase === 'waiting' && session !== null ? (
            <div className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-border bg-surface p-3">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={codeInputRef}
                  readOnly
                  value={session.userCode}
                  aria-label="GitHub 验证码"
                  spellCheck={false}
                  onFocus={(event) => event.currentTarget.select()}
                  className="tabular w-[11ch] border-0 bg-transparent p-0 text-[24px] font-semibold leading-tight tracking-[0.14em] text-text outline-none"
                />
                <Button variant="ghost" size="sm" onClick={handleCopyUserCode}>
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied ? '已复制' : '复制'}
                </Button>
                <span className="tabular ml-auto text-[11px] text-muted">
                  剩余 {formatCountdown(remaining)}
                </span>
              </div>

              <p className="text-[11px] leading-relaxed text-muted">
                {popupBlocked
                  ? '若浏览器拦截了弹窗，请点击下面链接打开授权页。'
                  : '已尝试在新标签页打开授权页。'}
              </p>
              <a
                className="inline-flex items-center gap-1 text-[12px] text-accent"
                href={session.verificationUri}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink size={12} />
                打开 GitHub 授权页
              </a>

              <div className="flex flex-wrap items-center gap-2">
                <span className="flex items-center gap-1.5 text-[12px] text-muted">
                  <Loader2 size={12} className="animate-spin" />
                  等待授权中…
                </span>
                <Button variant="ghost" size="sm" onClick={handleCancelDeviceFlow}>
                  取消
                </Button>
              </div>
            </div>
          ) : null}

          {phase === 'success' ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-[12px] text-success">
                <Check size={13} />
                已连接：{successLogin ?? 'GitHub'}
              </span>
              <Button variant="ghost" size="sm" onClick={handleCancelDeviceFlow}>
                完成
              </Button>
            </div>
          ) : null}

          {phase === 'error' && deviceError !== null ? (
            <div className="flex flex-col gap-2">
              <p className="text-[12px] leading-relaxed text-danger">{deviceError}</p>
              <div>
                <Button variant="ghost" size="sm" onClick={handleStartDeviceFlow}>
                  重新生成验证码
                </Button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* 3. 手动 Token：Device Flow 不可用时是主路径，可用时折叠进 details */}
      {initial.deviceFlowAvailable ? (
        <details className="rounded-[var(--radius-sm)] border border-border px-3 py-2">
          <summary className="cursor-pointer text-[12px] text-muted">或手动填写 Token</summary>
          <div className="pt-3">{manualSection}</div>
        </details>
      ) : (
        <section className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-border bg-surface-2 p-3">
          <span className="text-[13px] font-medium text-text">手动填写 Token</span>
          {manualSection}
        </section>
      )}

      {/* 4. 清除按钮 / 环境变量说明
          两者互不排斥：`canClear` 只看本地是否存过 Token，
          所以「env 与 stored 并存」时清除按钮与环境变量提示会同时出现。 */}
      {initial.canClear ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="danger" size="sm" onClick={handleClearStoredToken} loading={clearing}>
            {clearing ? null : <Trash2 size={12} />}
            清除应用内 Token
          </Button>
          {clearError !== null ? (
            <span className="text-[11px] leading-relaxed text-danger">{clearError}</span>
          ) : null}
        </div>
      ) : null}

      {initial.source === 'env' ? (
        <p className="text-[12px] leading-relaxed text-muted">
          当前 Token 来自环境变量，需修改{' '}
          <code className="tabular text-text">GITHUB_TOKEN</code> 后重启服务。
        </p>
      ) : null}

      {/* 5. 未启用 Device Flow 时的说明 */}
      {initial.deviceFlowAvailable ? null : (
        <details className="rounded-[var(--radius-sm)] border border-border px-3 py-2">
          <summary className="cursor-pointer text-[12px] text-muted">如何启用一键授权</summary>
          <ol className="mt-2 flex list-decimal flex-col gap-1 pl-5 text-[12px] leading-relaxed text-muted">
            <li>在 GitHub 注册 OAuth App：Settings → Developer settings → OAuth Apps → New OAuth App。</li>
            <li>填写应用名与主页地址，Callback URL 可随意填写（Device Flow 不使用回调地址）。</li>
            <li>创建后在应用详情页勾选 Enable Device Flow。</li>
            <li>
              把 Client ID 填到 <code className="tabular text-text">.env</code> 的{' '}
              <code className="tabular text-text">GITHUB_OAUTH_CLIENT_ID</code> 后重启服务。
            </li>
            <li>只需 Client ID，不需要 Client Secret。</li>
          </ol>
        </details>
      )}
    </div>
  );
}
