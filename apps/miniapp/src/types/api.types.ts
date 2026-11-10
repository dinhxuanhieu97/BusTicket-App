/**
 * Kiểu dữ liệu của API công khai (apps/api/src/public.controller.ts).
 * Giữ khớp với máy chủ: TripsService.search / seatMap, BookingsService.BookingView, PaymentsService.paymentInstructions.
 */

export interface OpenRoute {
  code: string;
  origin: string;
  destination: string;
  fromPrice: number | null;
  tripCount: number;
  departAt: string;
}

export interface TripSummary {
  id: string;
  name: string;
  departAt: string;
  route: { code: string; origin: string; destination: string };
  vehicle: {
    name: string;
    code: string;
    type: "LIMOUSINE" | "SLEEPER" | "SEATER" | string;
    layoutName: string;
  };
  /** "phòng" | "giường" | "ghế" */
  unit: string;
  availableUnits: number;
  fromPrice: number | null;
}

export type PublicSeatStatus = "AVAILABLE" | "HELD" | "BOOKED" | "BLOCKED";

export interface LayoutFloor {
  /** "1" tầng dưới, "2" tầng trên. */
  code: string;
  label: string;
  /** Các ô cách nhau bằng dấu cách: mã chỗ, hoặc ".", "_", "TX", "CUA", "WC". */
  rows: string[];
}

export interface Fare {
  floor: string;
  occupancy: number;
  price: number;
}

export interface RouteStop { name: string; time: string; day: number }
export type Stops = Record<"pickup" | "dropoff", RouteStop[]>;
export interface SeatMap {
  stops?: Stops;
  trip: { id: string; name: string; departAt: string; onSale: boolean };
  booking: {
    requiresPhoneOtp: boolean;
    maxUnitsPerBooking: number;
    holdMinutes: number;
    depositPercent?: number;
    fixedDeposit?: { single: number; double: number } | null;
    childPolicy?: { price: number };
  };
  vehicle: { name: string; code: string };
  layout: {
    name: string;
    unit: string;
    kind: "room" | "bed" | "seat";
    floors: LayoutFloor[];
  };
  seats: {
    code: string;
    floor: string;
    maxOccupancy: number;
    status: PublicSeatStatus;
  }[];
  fares: Fare[];
}

export type BookingStatus =
  "HOLDING" | "CONFIRMED" | "EXPIRED" | "CANCELLED" | "COMPLETED";

export interface BookingItem {
  tripId?: string;
  seatCode: string;
  occupancy: number;
  infantCount: number;
  unitPrice: number;
  infantPrice: number;
  lineTotal: number;
}

export interface BookingView {
  note?: string;
  code: string;
  status: BookingStatus;
  tripId: string;
  tripContacts?: { tripId: string; phone: string }[];
  holdExpiresAt: string | null;
  totalAmount: number;
  depositAmount: number;
  paidAmount: number;
  paymentStatus: "UNPAID" | "PARTIAL" | "DEPOSIT_PAID" | "PAID";
  amountDueNow: number;
  items: BookingItem[];
}

export interface HoldResult {
  booking: BookingView;
  /** Khóa xem đơn — chỉ máy đặt vé giữ, gửi trong header X-Booking-Token. */
  accessToken: string;
  replayed: boolean;
}

export interface CreateHoldRequest {
  returnLeg?: { tripId: string; items: CreateHoldRequest["items"] };
  note?: string;
  tripId: string;
  contactName: string;
  contactPhone: string;
  items: { seatCode: string; occupancy: number; infantCount: number }[];
}

export type PaymentInstructions =
  | {
      code: string;
      payable: true;
      amountDue: number;
      transferContent: string;
      holdExpiresAt: string | null;
      bank: { code: string; accountNumber: string; accountName: string };
      qrImageUrl: string;
    }
  | {
      code: string;
      payable: false;
      reason: "PAID" | "NOT_PAYABLE";
      amountDue: 0;
    };

export interface PhoneVerificationStarted {
  verificationId: string;
  expiresAt: string;
}

export interface PhoneVerified {
  phoneToken: string;
  expiresAt: string;
}

/** SĐT do Zalo xác nhận (dạng 0xxxxxxxxx) kèm token dùng thay OTP. */
export interface ZaloPhone extends PhoneVerified {
  phone: string;
}
