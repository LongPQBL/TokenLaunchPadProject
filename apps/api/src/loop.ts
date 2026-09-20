/**
 * Runs `task` every `intervalMs`, never two at once: a tick that finds the previous pass still running is skipped,
 * because the passes fetch from the network and write rows. A throwing task is reported and the loop carries on.
 */
export function startLoop(
  task: () => Promise<unknown>,
  intervalMs: number,
  onError: (error: unknown) => void = (e) => console.error(e),
): { stop: () => void } {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await task();
    } catch (e) {
      onError(e);
    } finally {
      running = false;
    }
  }, intervalMs);
  return { stop: () => clearInterval(timer) };
}
