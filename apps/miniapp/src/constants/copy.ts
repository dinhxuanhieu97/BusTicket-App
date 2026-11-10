import tokens from "@/tokens";
import { config } from "@/config";

export const theme = tokens;

/** Mọi chữ hiển thị cho khách, tập trung một chỗ để nhà xe đổi tên/thông điệp mà không sửa màn hình. */
export const copy = {
  brand: { name: config.operatorName },
  nav: {
    book: "Đặt vé",
    myBookings: "Vé của tôi",
    profile: "Cá nhân",
    offers: "Ưu đãi",
  },
  common: {
    loading: "Đang tải...",
    back: "Quay lại",
    error: "Đã có lỗi xảy ra",
    networkError: "Vui lòng kiểm tra kết nối mạng",
    retry: "Thử lại",
    continue: "Tiếp tục",
    currency: "đ",
    copied: "Đã sao chép",
    copy: "Sao chép",
  },
  search: {
    title: "Chọn ngày đi",
    hero: "Chọn chuyến xe của bạn",
    oneWay: "Một chiều",
    roundTrip: "Khứ hồi",
    journeyType: "Loại hành trình",
    returnDate: "Ngày về",
    outbound: "Lượt đi",
    inbound: "Lượt về",
    roundTripHint:
      "Chọn chuyến đi, chuyến về và ghế từng lượt, sau đó thanh toán chung một đơn.",
    roundTripRequired:
      "Vui lòng chọn điểm đi, điểm đến và ngày về từ ngày đi trở đi.",
    returnSearch: "Xem chuyến lượt về",
    hint: "Chọn tuyến đường và ngày khởi hành.",
    origin: "Điểm đi",
    destination: "Điểm đến",
    allOrigins: "Tất cả điểm đi",
    allDestinations: "Tất cả điểm đến",
    date: "Ngày đi",
    submit: "Tìm chuyến xe",
    choose: "Chọn chỗ",
    results: "Chuyến xe ngày",
    routeHint: "Các điểm đi và đến được cập nhật theo ngày đã chọn.",
    otherDate: "Ngày khác",
    allRoutes: "Tất cả tuyến",
    empty: "Không có chuyến nào mở bán trong ngày này.",
    emptyHint: "Thử chọn ngày khác hoặc gọi tổng đài nhà xe.",
    available: (n: number, unit: string) => `Còn ${n} ${unit}`,
    soldOut: "Hết chỗ",
  },
  seats: {
    title: "Chọn chỗ",
    legendAvailable: "Còn trống",
    legendSelected: "Đang chọn",
    legendHeld: "Đang giữ",
    legendBooked: "Đã đặt",
    legendBlocked: "Không bán",
    notOnSale: "Chuyến này đã ngừng bán vé online.",
    maxUnits: (n: number) => `Mỗi đơn đặt tối đa ${n} chỗ.`,
    occupancy: "Số người",
    single: "1 người",
    double: "2 người",
    infants: "Trẻ dưới 2 tuổi đi kèm",
    selectedCount: (n: number, unit: string) => `${n} ${unit} đã chọn`,
    deposit: "Đặt cọc",
    totalDeposit: "Tổng tiền cọc",
    estimateHint: "Tiền cọc được xác nhận khi bạn giữ chỗ.",
    refreshed:
      "Một số chỗ bạn chọn vừa có người giữ, đã bỏ khỏi danh sách chọn.",
  },
  checkout: {
    title: "Thông tin đặt vé",
    contactName: "Họ tên người đi",
    contactPhone: "Số điện thoại",
    namePlaceholder: "Nguyễn Văn A",
    phonePlaceholder: "09xxxxxxxx",
    summary: "Chỗ đã chọn",
    submit: "Giữ chỗ",
    submitting: "Đang giữ chỗ...",
    holdNotice: (minutes: number) =>
      `Chỗ được giữ ${minutes} phút để bạn chuyển khoản đặt cọc.`,
    nameRequired: "Vui lòng nhập họ tên.",
    phoneInvalid: "Số điện thoại chưa đúng.",
    otpTitle: "Xác thực số điện thoại",
    otpHint:
      "Nhà xe đang mở bán cao điểm, cần xác thực số điện thoại trước khi giữ chỗ.",
    otpSend: "Gửi mã",
    otpCode: "Mã 6 số",
    otpVerify: "Xác nhận",
    otpVerified: "Đã xác thực số điện thoại",
    useZalo: "Dùng tên và số điện thoại Zalo",
    usingZalo: "Đang lấy thông tin từ Zalo...",
    zaloDenied: "Bạn chưa cho phép chia sẻ số điện thoại. Bạn có thể nhập tay.",
    zaloFilled: "Đã điền thông tin từ Zalo",
    noSelection: "Bạn chưa chọn chỗ nào.",
  },
  booking: {
    title: "Đơn đặt vé",
    code: "Mã đơn",
    status: {
      HOLDING: "Đang giữ chỗ",
      CONFIRMED: "Đã xác nhận",
      EXPIRED: "Hết hạn giữ chỗ",
      CANCELLED: "Đã hủy",
      COMPLETED: "Hoàn tất",
    } as Record<string, string>,
    holdLeft: "Thời gian giữ chỗ còn lại",
    payTitle: "Chuyển khoản đặt cọc",
    payHint:
      "Quét mã QR bằng ứng dụng ngân hàng. Nội dung chuyển khoản phải đúng mã đơn.",
    bank: "Ngân hàng",
    accountNumber: "Số tài khoản",
    accountName: "Chủ tài khoản",
    amount: "Số tiền",
    transferContent: "Nội dung",
    waiting:
      "Đang chờ xác nhận tiền cọc. Trang tự cập nhật khi nhà xe nhận được tiền.",
    confirmed:
      "Nhà xe đã nhận tiền. Vé điện tử sẽ được gửi khi tính năng vé hoàn tất.",
    expired:
      "Đơn đã hết hạn giữ chỗ. Nếu bạn đã chuyển khoản, vui lòng liên hệ nhà xe.",
    amountsTitle: "Chi tiết thanh toán",
    cancelled:
      "Đơn đã bị hủy. Nếu bạn đã chuyển khoản, vui lòng liên hệ nhà xe.",
    qrError:
      "Không tải được mã QR. Bạn có thể chuyển khoản theo thông tin bên dưới.",
    paymentNotPayable:
      "Đơn hiện không thể thanh toán. Vui lòng tải lại trạng thái đơn.",
    due: "Số tiền cọc cần chuyển",
    paymentUnavailable:
      "Nhà xe chưa cấu hình tài khoản nhận tiền. Vui lòng liên hệ tổng đài.",
    notFound: "Không tìm thấy đơn trên máy này.",
  },
  myBookings: {
    title: "Vé của tôi",
    empty: "Chưa có đơn nào",
    emptyHint: "Các đơn bạn đặt trên máy này sẽ hiện ở đây.",
    bookNow: "Đặt vé ngay",
    all: "Tất cả",
    pending: "Chờ thanh toán",
    details: "Xem chi tiết",
    noPending: "Không có đơn chờ thanh toán",
    statusLoading: "Đang cập nhật trạng thái…",
    statusError: "Chưa tải được trạng thái đơn. Mở chi tiết để thử lại.",
    seats: (n: number) => `${n} chỗ đã chọn`,
  },
  offers: {
    title: "Ưu đãi",
    details: "Xem chương trình",
    conditions:
      "Vui lòng liên hệ nhà xe để được hướng dẫn về điều kiện áp dụng và cách đăng ký.",
    notFound: "Không tìm thấy chương trình",
  },
  support: {
    title: "Hỗ trợ khách hàng",
    hint: "Liên hệ nhà xe để được hỗ trợ đặt vé và hướng dẫn các chương trình.",
    call: "Gọi",
    unavailable: "Nhà xe chưa cập nhật số điện thoại hỗ trợ trên ứng dụng.",
  },
  passengers: {
    title: "Sổ hành khách",
    add: "Thêm hành khách",
    edit: "Chỉnh sửa",
    remove: "Xóa",
    cancel: "Hủy chỉnh sửa",
    empty: "Chưa có hành khách được lưu.",
    choose: "Chọn hành khách đã lưu",
    confirmDelete: (name: string) =>
      `Xóa ${name} khỏi sổ hành khách trên thiết bị này?`,
  },
  banners: {
    label: "Thông tin nổi bật",
    tetTitle: "Đặt vé xe Tết",
    tetDescription: "Về nhà đón Tết, trọn vẹn sum vầy.",
    careTitle: "Miễn phí vé",
    careDescription: "Cho người khám bệnh hiểm nghèo",
    previous: "Banner trước",
    next: "Banner tiếp theo",
    pause: "Tạm dừng chuyển banner",
    play: "Tự động chuyển banner",
  },
  profile: {
    title: "Cá nhân",
    heading: "Thông tin cá nhân",
    hint: "Lưu thông tin để điền nhanh khi đặt vé. Bạn vẫn có thể đổi người đi ở bước đặt vé.",
    localNotice:
      "Thông tin được lưu trên thiết bị này, chưa đồng bộ sang thiết bị khác.",
    save: "Lưu thông tin",
    saved: "Đã lưu thông tin cá nhân",
    name: "Họ và tên",
    phone: "Số điện thoại",
  },
  errors: {
    SEAT_UNAVAILABLE: "Chỗ bạn chọn vừa có người giữ. Vui lòng chọn chỗ khác.",
    TRIP_NOT_ON_SALE: "Chuyến này đã ngừng bán vé online.",
    TOO_MANY_ATTEMPTS: "Bạn thao tác quá nhanh, vui lòng thử lại sau ít phút.",
    NETWORK_ERROR: "Không kết nối được máy chủ, vui lòng kiểm tra mạng.",
  } as Record<string, string>,
};

/** Thông điệp cho khách: ưu tiên câu riêng theo mã lỗi, không thì dùng thông điệp tiếng Việt từ máy chủ. */
export function errorMessage(error: unknown): string {
  const e = error as { code?: string; message?: string } | null;
  return (e?.code && copy.errors[e.code]) || e?.message || copy.common.error;
}
