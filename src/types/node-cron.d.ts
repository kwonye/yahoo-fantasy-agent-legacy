declare module 'node-cron' {
  // Minimal typings to satisfy the compiler
  type ScheduledTask = { start: () => void; stop: () => void };
  type Task = () => void | Promise<void>;
  function schedule(expression: string, task: Task, options?: { timezone?: string }): ScheduledTask;
  const _default: { schedule: typeof schedule };
  export { schedule };
  export default _default;
}

