import tokens from "@/tokens";
import { config } from "@/config";
import { APIError } from "@/lib/api-error";

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
    error: "Đã có lỗi xảy ra. Vui lòng thử lại.",
    networkError: "Không kết nối được. Kiểm tra mạng rồi thử lại.",
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
    refreshed: "Chỗ vừa hết đã được bỏ khỏi danh sách chọn",
    loadError: "Chưa tải được sơ đồ chỗ.",
    refreshError:
      "Chưa cập nhật được sơ đồ. Tình trạng chỗ có thể đã thay đổi.",
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
    otpResend: "Gửi lại mã",
    otpSent: "Đã gửi mã qua SMS. Nhập mã 6 số để tiếp tục.",
    otpCode: "Mã 6 số",
    otpVerify: "Xác nhận",
    otpVerified: "Đã xác thực số điện thoại",
    useZalo: "Dùng tên và số điện thoại Zalo",
    usingZalo: "Đang lấy thông tin từ Zalo...",
    zaloDenied: "Chưa nhận được số điện thoại từ Zalo. Bạn nhập tay bên dưới nhé.",
    zaloNameOnly: "Đã điền tên từ Zalo. Bạn nhập thêm số điện thoại nhé.",
    zaloError: "Chưa lấy được thông tin từ Zalo. Bạn có thể nhập tay.",
    zaloFilled: "Đã điền tên và số điện thoại từ Zalo",
    zaloPhoneFilled: "Đã điền số điện thoại từ Zalo",
    zaloConsent: {
      title: "Điền nhanh thông tin bằng Zalo",
      nameLabel: "Tên Zalo",
      nameReason: "Điền sẵn tên người đặt vé",
      phoneLabel: "Số điện thoại Zalo",
      phoneReason: "Để nhà xe xác nhận vé và liên hệ khi cần",
      note: "Thông tin chỉ dùng cho vé bạn đặt, không hiển thị công khai. Zalo sẽ hỏi bạn cho phép ở bước tiếp theo.",
      accept: "Tiếp tục với Zalo",
      manual: "Tự nhập",
    },
    noSelection: "Bạn chưa chọn chỗ nào.",
    loadOutboundError: "Chưa tải được thông tin chuyến đi.",
    loadInboundError: "Chưa tải được thông tin lượt về.",
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
    deadlinePassed:
      "Hạn chuyển khoản đã hết. Nếu đã chuyển khoản, hãy kiểm tra lại trạng thái đơn.",
    refreshError:
      "Chưa cập nhật được trạng thái đơn. Kiểm tra lại trước khi chuyển khoản.",
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
    followContact:
      "Vui lòng theo dõi điện thoại, Zalo và SMS để nhận xác nhận từ nhà xe.",
    confirmed:
      "Nhà xe đã nhận tiền. Bạn có thể xem và tải phiếu đặt vé ngay trên trang này.",
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
    unavailable: "Không tìm thấy đơn đặt vé.",
    unavailableHint:
      "Nếu bạn đã chuyển khoản, hãy liên hệ nhà xe và cung cấp mã đơn.",
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
    statusUnavailable: "Không tìm thấy đơn để cập nhật trạng thái.",
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
    hint: "Họ tên và số điện thoại từ lần đặt vé gần nhất được lưu để điền nhanh. Bạn có thể sửa thông tin tại đây.",
    localNotice:
      "Thông tin được lưu trên thiết bị này, chưa đồng bộ sang thiết bị khác.",
    save: "Lưu thông tin",
    saved: "Đã lưu thông tin cá nhân",
    name: "Họ và tên",
    phone: "Số điện thoại",
    clear: {
      heading: "Xóa dữ liệu",
      intro: "Xóa họ tên, số điện thoại và hành khách đã lưu. Bạn có thể xóa luôn thông tin này trong vé đã đặt.",
      open: "Xóa thông tin đã lưu",
      title: "Xóa thông tin đã lưu?",
      body: "Họ tên, số điện thoại, danh sách hành khách và lựa chọn chia sẻ từ Zalo sẽ bị xóa khỏi máy này. Lần đặt vé sau bạn cần nhập lại.",
      eraseInBookings: "Xóa cả họ tên và số điện thoại trong vé đã đặt",
      eraseInBookingsHint: "Áp dụng cho vé đã qua giờ khởi hành. Vé sắp đi vẫn giữ để nhà xe liên hệ.",
      removeBookings: "Bỏ danh sách vé khỏi máy này",
      removeBookingsHint: "Bạn sẽ không mở lại được vé trên máy này. Vé vẫn còn hiệu lực ở nhà xe.",
      confirm: "Xóa thông tin",
      clearing: "Đang xóa…",
      cancel: "Giữ lại",
      done: "Đã xóa thông tin đã lưu trên máy này.",
      doneWithBookings: (n: number) => `Đã xóa thông tin đã lưu và thông tin trong ${n} vé.`,
      kept: (n: number) =>
        `${n} vé chưa xóa được vì chuyến chưa khởi hành hoặc còn tiền cọc cần đối soát. Nhà xe vẫn giữ thông tin để liên hệ; bạn xóa lại được sau giờ khởi hành.`,
      failed: (n: number) => `Chưa xóa được thông tin trong ${n} vé do lỗi kết nối. Vui lòng thử lại.`,
      contact: "Liên hệ nhà xe",
    },
  },
  errors: {
    SEAT_UNAVAILABLE: "Chỗ bạn chọn vừa có người giữ. Vui lòng chọn chỗ khác.",
    TRIP_NOT_ON_SALE: "Chuyến này đã ngừng bán vé online.",
    TOO_MANY_ATTEMPTS: "Bạn thao tác quá nhanh, vui lòng thử lại sau ít phút.",
  } as Record<string, string>,
};

/** Known business errors may carry a safe customer-facing API message. */
export function errorMessage(error: unknown): string {
  if (!(error instanceof APIError)) return copy.common.error;
  if (error.status === 0) return copy.common.networkError;
  if (error.status >= 500) return copy.common.error;
  if (Object.prototype.hasOwnProperty.call(copy.errors, error.code))
    return copy.errors[error.code];
  return error.message || copy.common.error;
}
