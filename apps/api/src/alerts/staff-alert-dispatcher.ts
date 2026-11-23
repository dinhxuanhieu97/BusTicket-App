import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { StaffAlertConfig, StaffAlertsService } from './staff-alerts.service';

/** Tác vụ nền gửi thư báo nhà xe từ outbox (giống HoldSweeper: bỏ lượt nếu lượt trước chưa xong). */
@Injectable()
export class StaffAlertDispatcher implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(StaffAlertDispatcher.name);
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<number> | undefined;

  constructor(
    private readonly alerts: StaffAlertsService,
    private readonly config: StaffAlertConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.intervalMs <= 0) return;
    this.timer = setInterval(() => void this.tick(), this.config.intervalMs);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.running?.catch(() => undefined);
  }

  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = this.alerts.dispatchDue();
    try {
      const n = await this.running;
      if (n) this.log.log(`Sent ${n} staff alert email(s)`);
      return n;
    } catch (e) {
      this.log.error('Staff alert dispatch failed', e instanceof Error ? e.stack : String(e));
      return 0;
    } finally {
      this.running = undefined;
    }
  }
}
