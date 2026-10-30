/**
 * Round 53 (a): remove the phone tokens Expo answered DeviceNotRegistered for (the app was uninstalled, or the phone made
 * a new token). Used by push-task and notify-office. service_role deletes nothing by design, so the removal goes through
 * the database function remove_dead_device_tokens; until 31 October both functions deleted with service_role and never read
 * the error, so a dead token stayed and was sent to on every push. The error is read and logged here, and handed back so
 * the caller writes it into its own record (push_log, the outbox row); a failed removal never fails the push.
 */
export type RpcClient = {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

export type Removal = { removed: number; error?: string };

export async function removeDeadTokens(db: RpcClient, ids: readonly string[], source: string): Promise<Removal> {
  if (ids.length === 0) return { removed: 0 };
  try {
    const { data, error } = await db.rpc("remove_dead_device_tokens", { p_ids: [...ids] });
    if (error) {
      console.error(`${source}: removing ${ids.length} dead phone token(s) failed: ${error.message}`);
      return { removed: 0, error: `remove_tokens: ${error.message}`.slice(0, 200) };
    }
    const removed = typeof data === "number" ? data : 0;
    console.log(`${source}: removed ${removed} dead phone token(s)`);
    return { removed };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`${source}: removing ${ids.length} dead phone token(s) failed: ${message}`);
    return { removed: 0, error: `remove_tokens: ${message}`.slice(0, 200) };
  }
}
