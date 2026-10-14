/** Cloudflare DO bills wall time while a getupdates fetch is outstanding.
 * Keep a short, bounded listen period and leave the object dormant between polls.
 * A timed-out listen does not acknowledge iLink's cursor; the next alarm retries it.
 *
 * Trade-off: when no messages are arriving, new WeChat messages may wait for the
 * next listen window (typically <= 22 seconds) before the bot sees them.
 */
export const WECHAT_LISTEN_TIMEOUT_MS=8_000;
export const WECHAT_IDLE_INTERVAL_MS=22_000;
export const WECHAT_ACTIVE_INTERVAL_MS=1_500;
export const WECHAT_FAILURE_RETRY_MS=30_000;

export type PollOutcome='messages'|'empty'|'idle-timeout'|'error';
export function nextWechatPollDelay(outcome:PollOutcome):number {
 return outcome==='messages'?WECHAT_ACTIVE_INTERVAL_MS:
  outcome==='error'?WECHAT_FAILURE_RETRY_MS:WECHAT_IDLE_INTERVAL_MS;
}
export function isWechatIdleTimeout(error:unknown):boolean {
 return error instanceof Error&&error.message==='WECHAT_GETUPDATES_TIMEOUT';
}
