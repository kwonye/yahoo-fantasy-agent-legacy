import { Scheduler } from '../../src/services/Scheduler';

describe('Scheduler', () => {
  jest.useFakeTimers();

  it('schedules next run for tomorrow when time passed', () => {
    const task = jest.fn();
    const scheduler = new Scheduler(task, { hour: 0, minute: 0, runOnStart: false });
    scheduler.start();
    // It sets a timeout; advance timers to trigger
    // Jump almost 24h to ensure execution
    jest.advanceTimersByTime(24 * 60 * 60 * 1000 + 1000);
    expect(task).toHaveBeenCalled();
    scheduler.stop();
  });

  it('runs on start when configured', () => {
    const task = jest.fn();
    const scheduler = new Scheduler(task, { hour: 23, minute: 59, runOnStart: true });
    scheduler.start();
    expect(task).toHaveBeenCalled();
    scheduler.stop();
  });
});

