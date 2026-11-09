import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { BookingsService } from './bookings.service';

/** Chu kỳ dọn đơn giữ chỗ quá hạn (ms); 0 = tắt (mặc định trong test). */
export class HoldSweepConfig {
  readonly intervalMs: number;
  constructor(intervalMs: number) {
    // Giá trị env sai (NaN, âm) không được biến thành vòng lặp 1 ms.
    this.intervalMs = Number.isFinite(intervalMs) && intervalMs >= 1000 ? intervalMs : 0;
  }
}

/**
 * Tác vụ nền: định kỳ chuyển đơn HOLDING quá lúc nhả chỗ sang EXPIRED và trả chỗ.
 * Sơ đồ chỗ đã tự coi đơn quá hạn là trống (hết hạn lười), tác vụ này giữ dữ liệu DB, báo cáo và
 * giới hạn "số đơn đang giữ" đúng ngay cả khi không ai đặt thêm trên chuyến đó.
 * Chạy song song nhiều instance vẫn an toàn: mỗi chuyến được khóa hàng trước khi cập nhật.
 */
@Injectable()
export class HoldSweeper implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(HoldSweeper.name);
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<number> | undefined;

  constructor(
    private readonly bookings: BookingsService,
    private readonly config: HoldSweepConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.intervalMs <= 0) return;
    this.timer = setInterval(() => void this.sweep(), this.config.intervalMs);
    this.timer.unref();
  }

  /** Dừng hẹn giờ sớm nhất có thể (onModuleDestroy) để không chạy lượt mới khi pool DB đang đóng. */
  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.running?.catch(() => undefined);
  }

  /** Một lượt dọn; bỏ qua nếu lượt trước chưa xong. Trả số đơn đã chuyển sang EXPIRED. */
  async sweep(): Promise<number> {
    if (this.running) return 0;
    this.running = this.bookings.expireDueHolds();
    try {
      const n = await this.running;
      if (n) this.log.log(`Expired ${n} overdue hold(s)`);
      return n;
    } catch (e) {
      this.log.error('Hold sweep failed', e instanceof Error ? e.stack : String(e));
      return 0;
    } finally {
      this.running = undefined;
    }
  }
}
