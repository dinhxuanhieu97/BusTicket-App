import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { TripSchedulesService } from './trip-schedules.service';
export class ScheduleRunnerConfig {
  constructor(readonly intervalMs = 0) {}
}
@Injectable()
export class ScheduleRunner implements OnApplicationBootstrap, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running?: Promise<number>;
  private readonly log = new Logger(ScheduleRunner.name);
  constructor(
    private readonly schedules: TripSchedulesService,
    private readonly config: ScheduleRunnerConfig,
  ) {}
  onApplicationBootstrap() {
    if (!Number.isFinite(this.config.intervalMs) || this.config.intervalMs < 1000) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.config.intervalMs);
    this.timer.unref();
  }
  async tick() {
    if (this.running) return;
    this.running = this.schedules.runDue();
    try {
      await this.running;
    } catch {
      this.log.error('Schedule runner failed; will retry on next tick.');
    } finally {
      this.running = undefined;
    }
  }
  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.running?.catch(() => undefined);
  }
}
