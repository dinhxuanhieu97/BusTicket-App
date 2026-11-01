# PhongNhungTicket

> Tài liệu định hướng sản phẩm và đặc tả triển khai web app đặt vé xe khách.

| Thuộc tính | Giá trị |
| --- | --- |
| Tên dự án | PhongNhungTicket |
| Tên viết tắt | PNTicket |
| Tên tài liệu | PNTicketDocs.md |
| Phiên bản | 0.1 — Đề xuất để rà soát |
| Ngày cập nhật | 01/11/2026 |
| Ngôn ngữ | Tiếng Việt |
| Múi giờ nghiệp vụ | Asia/Ho_Chi_Minh |
| Đơn vị tiền tệ | VND, lưu bằng số nguyên |

Tài liệu tổng hợp ý tưởng đã trao đổi và bổ sung đề xuất kỹ thuật để đội phát triển có thể lập kế hoạch. Các giá vé, tỷ lệ cọc, thời hạn và mục tiêu tải dưới đây là giả định minh họa hoặc đề xuất, chưa phải chính sách đã được nhà xe phê duyệt. Đây là tài liệu thiết kế; chưa có hệ thống bán vé hoặc kết nối nhận tiền thật được triển khai.

## Mục lục

1. [Bối cảnh và mục tiêu](#1-bối-cảnh-và-mục-tiêu)
2. [Phạm vi sản phẩm](#2-phạm-vi-sản-phẩm)
3. [Người dùng và phân quyền](#3-người-dùng-và-phân-quyền)
4. [Luồng đặt vé](#4-luồng-đặt-vé)
5. [Quy tắc nghiệp vụ](#5-quy-tắc-nghiệp-vụ)
6. [Thanh toán và đối soát](#6-thanh-toán-và-đối-soát)
7. [Vé và thông báo](#7-vé-và-thông-báo)
8. [Màn hình và trải nghiệm](#8-màn-hình-và-trải-nghiệm)
9. [Kiến trúc kỹ thuật](#9-kiến-trúc-kỹ-thuật)
10. [Mô hình dữ liệu](#10-mô-hình-dữ-liệu)
11. [API dự kiến](#11-api-dự-kiến)
12. [Bảo mật và vận hành](#12-bảo-mật-và-vận-hành)
13. [Kiểm thử và nghiệm thu](#13-kiểm-thử-và-nghiệm-thu)
14. [Lộ trình và chi phí](#14-lộ-trình-và-chi-phí)
15. [Những quyết định cần chốt](#15-những-quyết-định-cần-chốt)
16. [Nguồn tham khảo](#16-nguồn-tham-khảo)

## 1. Bối cảnh và mục tiêu

Người lao động tại TP.HCM gặp khó khăn khi mua vé xe giường nằm về quê dịp Lễ và Tết: khó liên hệ nhà xe, không biết còn chỗ hay không, chuyển cọc rồi phải chờ xác nhận. Nhà xe đồng thời phải tổng hợp đơn qua điện thoại, tin nhắn và sổ tay, dễ nhầm chỗ hoặc thiếu thông tin thanh toán.

PhongNhungTicket cung cấp một nơi đặt vé trực tuyến và một hệ thống vận hành chung cho nhà xe Phong Nhung.

### 1.1. Mục tiêu

- Khách chủ động tìm chuyến, chọn giường và nhận xác nhận rõ ràng.
- Nhà xe bán vé trực tuyến và bán qua nhân viên trên cùng kho chỗ.
- Tự động ghi nhận chuyển khoản hợp lệ, theo dõi tiền cọc và tiền còn thiếu.
- Giảm thao tác đối chiếu thủ công và có lịch sử kiểm tra khi xảy ra tranh chấp.
- Hỗ trợ cao điểm bằng giữ chỗ có thời hạn, kiểm soát tải và danh sách chờ.

Website không tự tạo thêm năng lực vận chuyển. Khi hết chỗ, hệ thống giúp ghi nhận nhu cầu và hỗ trợ nhà xe quyết định bổ sung chuyến.

### 1.2. Bối cảnh minh họa

Ảnh tham chiếu của người dùng thể hiện thương hiệu Phong Nhung Limousine, tuyến TP.HCM ↔ Hoài Ân và xe 24 phòng. Dữ liệu quảng cáo chỉ dùng làm đầu vào thiết kế; địa danh hiển thị, lịch chạy, số điện thoại, số phòng và sơ đồ xe phải xác minh lại trước khi công bố.

## 2. Phạm vi sản phẩm

### 2.1. MVP — Bản vận hành đầu tiên

| Nhóm | Chức năng |
| --- | --- |
| Khách hàng | Tìm chuyến, xem giá và chỗ trống, chọn giường/phòng |
| Đặt vé | Thông tin người đặt và hành khách, điểm đón/trả, giữ chỗ có hạn |
| Thanh toán | QR chuyển khoản, cọc hoặc trả đủ theo cấu hình, xác nhận tự động |
| Vé | Trang vé điện tử, mã vé, QR kiểm tra lên xe, tra cứu bảo mật |
| Thông báo | Email giao dịch và SMS xác nhận qua nhà cung cấp được chọn |
| Bán vé nội bộ | Nhân viên đặt hộ, thu tiền mặt, đổi/hủy có kiểm soát |
| Điều hành | Chuyến, xe, sơ đồ giường, danh sách khách và điểm đón |
| Tài chính | Tiền nhận, cọc, còn phải thu, giao dịch chưa khớp, hoàn tiền có duyệt |
| Quản trị | Phân quyền, nhật ký thao tác, xuất báo cáo |

MVP phục vụ một nhà xe; một chỗ được bán cho toàn chuyến. Đặt chiều về tạo đơn riêng để giảm độ phức tạp khi đổi/hủy. Một đơn có thể chứa nhiều hành khách trên cùng chuyến.

### 2.2. Giai đoạn tiếp theo

- Danh sách chờ có thời hạn nhận chỗ và chuyến tăng cường.
- Hàng đợi truy cập khi tải mở bán vượt năng lực hệ thống đã kiểm thử.
- Đổi/hủy tự phục vụ theo chính sách, nhắc lịch tự động.
- Quản lý trung chuyển, đại lý và hoa hồng.
- Bán vé theo từng đoạn tuyến không chồng lấn.
- Khứ hồi trong một đơn, khách hàng thân thiết, nhiều nhà xe.
- Kết nối hóa đơn điện tử hoặc phần mềm kế toán khi có yêu cầu được xác định.

Không đưa ứng dụng di động riêng, ví điện tử nội bộ hoặc định giá tự động vào MVP.

## 3. Người dùng và phân quyền

| Vai trò | Quyền chính | Giới hạn |
| --- | --- | --- |
| Khách | Đặt, thanh toán, xem vé của mình, gửi yêu cầu hỗ trợ | Không xem dữ liệu người khác |
| Bán vé | Đặt hộ, tìm đơn, đổi chỗ theo chính sách | Không tự sửa giao dịch ngân hàng hoặc duyệt hoàn |
| Kế toán | Đối soát, ghi nhận thu hợp lệ, xử lý khoản dư/thiếu | Không xóa lịch sử tài chính |
| Điều hành | Lịch chạy, xe, danh sách khách, thay đổi chuyến | Không tự hoàn tiền |
| Tài xế/phụ xe | Xem chuyến được giao, điểm đón, xác nhận lên xe, ghi nhận thu được cấp quyền | Không xem toàn bộ doanh thu hoặc mọi chuyến |
| Chủ xe/quản trị | Cấu hình, phân quyền, duyệt hoàn, xem báo cáo | Các thao tác nhạy cảm vẫn lưu nhật ký |

Đề xuất tài khoản quản trị bật xác thực nhiều yếu tố. Phân quyền được kiểm tra tại máy chủ, không chỉ ẩn nút trên giao diện.

## 4. Luồng đặt vé

1. Khách chọn điểm đi, điểm đến, ngày đi và số người.
2. Hệ thống trả chuyến đang mở bán, giá, giờ đi và chỗ còn lại.
3. Khách chọn giường, điểm đón/trả và điền thông tin.
4. Máy chủ kiểm tra lại giá và tạo đơn giữ chỗ trong một giao dịch cơ sở dữ liệu.
5. Hiển thị tổng tiền, số tiền cần trả để xác nhận, QR và giờ hết hạn.
6. Khách chuyển khoản; hệ thống chờ sự kiện thanh toán đã xác thực.
7. Khi đủ điều kiện và chỗ còn được giữ hợp lệ, đơn được xác nhận và phát hành vé.
8. Vé hiển thị trên trang kết quả; email/SMS được gửi độc lập qua hàng đợi.
9. Nhân viên kiểm tra vé và ghi nhận lên xe; thu phần còn lại nếu có.

Khách không bắt buộc tạo tài khoản. Email là tùy chọn; số điện thoại liên hệ là bắt buộc. Nếu không có email, khách vẫn nhận SMS và sử dụng trang tra cứu.

### Ví dụ minh họa

- Hai vé: 500.000 đồng/vé, tổng 1.000.000 đồng.
- Chính sách giả định: cọc 50%, cần chuyển 500.000 đồng.
- Khi xác nhận: hiển thị “Đã cọc 500.000 đồng; còn thanh toán 500.000 đồng”.
- Nếu chuyển thêm 500.000 đồng hợp lệ: cập nhật “Đã thanh toán đủ”.

## 5. Quy tắc nghiệp vụ

### 5.1. Chuyến và kho chỗ

- Mỗi chuyến là một lần khởi hành cụ thể, có xe/sơ đồ chỗ và thời điểm mở/đóng bán.
- Chuyến đi và chuyến về có kho chỗ độc lập.
- Vé online, vé điện thoại, vé tại quầy đều sử dụng cùng kho chỗ.
- Mỗi chỗ trên một chuyến chỉ có tối đa một quyền chiếm chỗ đang hiệu lực.
- Chọn chỗ trên giao diện chưa tạo quyền giữ chỗ; chỉ xác nhận giữ sau khi máy chủ lưu thành công.
- Giữ nhiều chỗ trong một đơn phải thành công toàn bộ hoặc thất bại toàn bộ.
- Giá, phụ thu, mức cọc và chính sách được chụp lại tại thời điểm đặt; thay giá sau đó không âm thầm sửa đơn cũ.
- Xe/sơ đồ của chuyến có khách không được thay đổi trực tiếp mà bỏ qua bước ánh xạ lại chỗ và kiểm tra sức chứa.

### 5.2. Giữ chỗ

- Đề xuất ban đầu: 10 phút, cho phép nhà xe cấu hình sau khi thử nghiệm.
- Thời gian máy chủ là nguồn quyết định; đồng hồ trình duyệt chỉ hiển thị.
- Tác vụ nền giải phóng đơn hết hạn; thao tác đặt và thanh toán cũng phải kiểm tra hạn để không phụ thuộc riêng vào tác vụ nền.
- Giao dịch hết hạn và giao dịch xác nhận thanh toán khóa cùng dữ liệu đơn/kho chỗ để không bán trùng.
- Giới hạn số chỗ mỗi đơn, số đơn đang giữ và tần suất thao tác; ngưỡng cụ thể cần chốt.
- Khi hết hạn, vẫn lưu lịch sử đơn và giao dịch đến sau; không xóa dấu vết tài chính.

### 5.3. Trạng thái tách biệt

| Đối tượng | Trạng thái đề xuất |
| --- | --- |
| Đơn đặt | HOLDING, CONFIRMED, EXPIRED, CANCELLED, COMPLETED |
| Thanh toán | UNPAID, PARTIAL, DEPOSIT_PAID, PAID, OVERPAID |
| Xử lý ngoại lệ | NEEDS_REVIEW, RESOLVED |
| Hoàn tiền | REQUESTED, APPROVED, PROCESSING, SUCCEEDED, FAILED, REJECTED |
| Vé | VALID, USED, VOID |
| Thông báo | QUEUED, SENT, DELIVERED, FAILED, UNKNOWN |

Đơn xác nhận có thể mới cọc; gửi email thất bại không làm vé mất hiệu lực. Hoàn một phần được ghi riêng, không làm mất số tiền thu ban đầu. Trạng thái hoàn và thanh toán không gộp thành một trường.

### 5.4. Đổi, hủy và hoàn

- Hiển thị chính sách thường/Lễ/Tết trước khi khách thanh toán và lưu phiên bản khách đã chấp thuận.
- Đổi chỗ/chuyến phải giữ được chỗ mới một cách an toàn trước khi hoàn tất giải phóng chỗ cũ; tính chênh lệch giá rõ ràng.
- Hủy một hành khách trong đơn nhiều vé chỉ giải phóng chỗ và điều chỉnh giá trị của phần bị hủy.
- Hủy vé và hoàn tiền là hai nghiệp vụ riêng: vé có thể đã hủy trong khi hoàn tiền còn xử lý.
- MVP tạo yêu cầu hoàn, có người duyệt và bằng chứng thực hiện; chưa mặc định tự chuyển tiền ra ngân hàng.
- Mỗi lần hoàn phải kiểm tra tổng tiền có thể hoàn, kể cả yêu cầu đang xử lý, để không hoàn vượt mức.
- Thay đổi lịch, đổi xe hoặc hủy chuyến phải lập danh sách khách ảnh hưởng và theo dõi thông báo.

## 6. Thanh toán và đối soát

### 6.1. Phương án tích hợp

Đề xuất chọn một trong SePay hoặc payOS sau khi kiểm tra điều kiện tài khoản ngân hàng, phương thức kết nối và phí thực tế. Việc tạo QR đơn thuần không chứng minh tiền đã về.

Máy chủ tạo yêu cầu thanh toán theo đơn; nhận thông báo giao dịch từ nhà cung cấp; xác thực, lưu và phân bổ tiền vào đơn. Trang quay về sau thanh toán và nút “Tôi đã chuyển khoản” không phải bằng chứng thanh toán.

### 6.2. Quy trình xử lý

1. Xác thực chữ ký hoặc cơ chế xác thực theo đúng dịch vụ đã chọn.
2. Kiểm tra môi trường, loại sự kiện, tài khoản nhận, chiều tiền vào, mã tham chiếu và tiền tệ/số tiền.
3. Lưu sự kiện bền vững, loại trùng bằng khóa duy nhất phù hợp với nhà cung cấp và tài khoản.
4. Khóa đơn và kho chỗ liên quan, ghi giao dịch và phân bổ tiền trong cùng giao dịch cơ sở dữ liệu.
5. Xác định tổng tiền hợp lệ đã phân bổ; cập nhật trạng thái thanh toán.
6. Nếu đủ mức cần trả, đơn còn hiệu lực và sở hữu chỗ: xác nhận đơn, tạo vé và sự kiện gửi thông báo.
7. Nếu hết hạn hoặc dữ liệu không khớp: lưu tiền vào luồng ngoại lệ, không tự phát hành vé.
8. Trả phản hồi đúng hợp đồng webhook của dịch vụ; thử lại xử lý nội bộ khi có lỗi.

Lưu thông báo cần gửi trong cùng giao dịch với việc xác nhận vé (transactional outbox), sau đó tác vụ nền gửi. Nhờ đó việc máy chủ khởi động lại không làm mất yêu cầu gửi vé.

### 6.3. Ngoại lệ bắt buộc hỗ trợ

| Tình huống | Xử lý |
| --- | --- |
| Chuyển thiếu mức cọc | Lưu tiền đã nhận, báo số thiếu; chưa xác nhận vé |
| Chuyển nhiều lần | Cộng các khoản hợp lệ đã phân bổ, không cộng trùng |
| Chuyển dư | Xác định khoản dư riêng, chuyển nhân viên xử lý |
| Sai/thiếu mã đơn | Lưu giao dịch chưa khớp, đối chiếu có kiểm soát |
| Tiền đến sau hết hạn | NEEDS_REVIEW; chỉ cấp lại chỗ qua thao tác có kiểm tra, không lấy chỗ của khách khác |
| Webhook gửi lặp | Không tăng số tiền, không phát thêm vé hoặc gửi trùng thông báo |
| Webhook thiếu/chậm | Đối soát định kỳ qua API hoặc báo cáo được hỗ trợ |
| Chỉ có ảnh biên lai | Tiếp nhận hỗ trợ, không coi là tiền đã nhận |
| Nhà cung cấp gián đoạn | Hiện trạng thái đang kiểm tra; không báo chắc chắn chưa trả khi chưa đối soát |

### 6.4. Sổ thu và báo cáo

- Mỗi giao dịch ngân hàng chỉ được ghi nhận một lần; một đơn có thể nhận nhiều giao dịch.
- Một giao dịch không được phân bổ vượt số tiền thực nhận. Phân bổ thủ công cần quyền và lịch sử người thực hiện.
- Giao dịch gốc không sửa/xóa; sai sót xử lý bằng bản ghi điều chỉnh có liên kết.
- Phân biệt ngày nhận tiền và ngày khởi hành khi lọc báo cáo.
- Báo cáo riêng tiền ngân hàng, tiền mặt, cọc, phần thu thêm, khoản dư, hoàn tiền và giao dịch chưa khớp.
- “Giá trị vé đã bán” không được gọi là “tiền thực thu” hoặc tự coi là doanh thu kế toán đã ghi nhận.
- Khoản còn phải thu = giá trị đơn sau điều chỉnh hợp lệ − tiền đã phân bổ giữ lại cho đơn, tối thiểu bằng 0; khoản dư theo dõi riêng.
- Hoàn một khoản dư không được làm tăng nợ vé. Hủy/hoàn phải cập nhật cả giá trị nghĩa vụ thanh toán và phân bổ tiền tương ứng.

## 7. Vé và thông báo

### 7.1. Nội dung vé

- Mã vé riêng cho từng hành khách, mã đơn cho nhóm.
- Tuyến, ngày giờ khởi hành, giường/phòng và điểm đón/trả.
- Tên hành khách, số điện thoại liên hệ được che bớt khi phù hợp.
- Tổng giá, tiền đã trả và số còn lại.
- Hướng dẫn có mặt, liên hệ hỗ trợ và chính sách áp dụng.
- QR chứa mã định danh/token khó đoán, không chứa trực tiếp toàn bộ thông tin cá nhân.

QR vé được kiểm tra bởi nhân viên đã đăng nhập; thao tác lên xe có tính chống lặp. Tra cứu và kiểm soát lên xe không dùng chung token nếu phạm vi quyền khác nhau.

### 7.2. Kênh gửi

| Kênh | Mục đích |
| --- | --- |
| Trang vé | Nguồn trạng thái hiện tại, tải/xem lại vé |
| Email | Thông tin đầy đủ và liên kết vé, gửi tới Gmail hoặc hộp thư khác |
| SMS | Xác nhận ngắn, mã vé, giờ đi, liên kết tra cứu |

Gửi từ tên miền nhà xe qua dịch vụ email giao dịch; cấu hình SPF, DKIM, DMARC trước khi vận hành. Nhà cung cấp SMS và yêu cầu tên người gửi cần được xác minh. Không bắt buộc tích hợp tài khoản Gmail cá nhân của chủ xe.

Lưu số lần thử, thời điểm, mã thông báo nhà cung cấp và lỗi; chỉ đánh dấu DELIVERED khi có bằng chứng từ kênh hỗ trợ. Email/SMS gửi lỗi không hủy vé. Chống gửi lặp theo vé, loại sự kiện và phiên bản thay đổi.

## 8. Màn hình và trải nghiệm

### 8.1. Khách hàng

1. Trang chủ: tìm chuyến, tuyến chính, thông tin nhà xe, hỗ trợ.
2. Kết quả tìm kiếm: giờ đi, loại xe, giá, số chỗ còn và điểm đón.
3. Chọn giường: tầng trên/dưới, hướng đầu xe, chú giải trạng thái.
4. Thông tin đặt vé: người đặt, từng hành khách, điểm đón/trả.
5. Kiểm tra đơn và thanh toán: chính sách, QR, số tiền, thời hạn giữ.
6. Kết quả/trang vé: đã cọc, trả đủ hoặc cần kiểm tra; hướng xử lý rõ ràng.
7. Tra cứu và yêu cầu hỗ trợ/đổi/hủy.

### 8.2. Nội bộ

1. Tổng quan vận hành.
2. Tuyến, điểm dừng, xe và sơ đồ giường.
3. Lịch chuyến, giá và thời gian mở bán.
4. Sơ đồ chỗ theo chuyến, đặt hộ và chuyển chỗ.
5. Danh sách đơn, vé và lịch sử thay đổi.
6. Thu tiền, giao dịch chưa khớp, đối soát và hoàn tiền.
7. Danh sách đón khách, kiểm tra lên xe.
8. Báo cáo và xuất CSV; cấu hình người dùng, chính sách, nhật ký.

### 8.3. Hướng thị giác

Đề xuất dùng đỏ, trắng và điểm nhấn đen theo ảnh thương hiệu; bố cục gọn, dễ thao tác bằng một tay. Tham khảo cách tổ chức luồng FUTA, không sao chép nhận diện hoặc tài sản của FUTA.

Chữ và nút đủ lớn; không dùng màu làm tín hiệu duy nhất. Hiện tổng giá và nghĩa vụ cọc trước khi thanh toán. Đồng hồ hết hạn phải kèm trạng thái bằng chữ. Trên điện thoại có nút lưu QR và sao chép số tài khoản, số tiền, nội dung; không giả định khách luôn có thiết bị thứ hai để quét.

## 9. Kiến trúc kỹ thuật

### 9.1. Lựa chọn đề xuất

| Thành phần | Đề xuất |
| --- | --- |
| Web | Next.js, TypeScript, giao diện thích ứng điện thoại |
| Nghiệp vụ/API | NestJS, TypeScript, một ứng dụng chia module |
| Dữ liệu chính | PostgreSQL |
| Tác vụ nền | Worker xử lý outbox, thông báo, hết hạn và đối soát |
| Redis/hàng đợi | Bổ sung khi cần cho tác vụ nền, cache và giới hạn tần suất |
| Thanh toán | Adapter cho một nhà cung cấp đã được chọn |
| Email/SMS | Adapter nhà cung cấp, theo dõi lỗi và gửi lại |
| Triển khai | Môi trường thử nghiệm tách sản xuất; cơ sở dữ liệu có sao lưu |

Đây là lựa chọn thiết kế để nhóm kỹ thuật đánh giá, không phải yêu cầu bắt buộc về nền tảng. Không cần microservices cho MVP. Chọn phiên bản thư viện còn được hỗ trợ tại thời điểm triển khai.

### 9.2. Nguyên tắc triển khai

- PostgreSQL là nguồn sự thật của kho chỗ và tiền; Redis không quyết định chỗ đã bán.
- Khóa hàng và ràng buộc duy nhất bảo vệ cạnh tranh đồng thời.
- Mọi thao tác tạo đơn, phân bổ tiền, hoàn và kiểm tra lên xe cần cơ chế chống thực thi lặp phù hợp.
- Các công việc chậm chạy nền; giao dịch nghiệp vụ không chờ email/SMS.
- Dữ liệu thời điểm lưu UTC, hiển thị giờ Việt Nam; lịch lặp theo ngày địa phương được chuyển đổi có chủ đích.
- Lỗi nhà cung cấp thanh toán không được làm mất khả năng tra cứu vé đã phát hành.

## 10. Mô hình dữ liệu

| Thực thể | Nội dung chính |
| --- | --- |
| users, roles | Tài khoản nội bộ, quyền và phạm vi chuyến |
| routes, stops, route_stops | Tuyến, điểm dừng theo thứ tự, điểm đón/trả hợp lệ |
| vehicles, seat_layouts, seats | Xe, mẫu sơ đồ, nhãn phòng, tầng |
| trips | Ngày giờ chạy, xe/sơ đồ phiên bản, trạng thái mở bán |
| trip_seats | Chỗ thực tế của chuyến, chủ giữ chỗ, hạn giữ, trạng thái |
| bookings | Người đặt, trạng thái, giá trị, mức cần trả, hạn, chính sách đã chụp |
| booking_items | Hành khách, chuyến/chỗ, điểm đón/trả, giá riêng, trạng thái |
| payment_requests | Mã thanh toán, đơn, số tiền yêu cầu, nhà cung cấp, hạn |
| provider_events | Sự kiện nhận vào, khóa chống trùng, kết quả xử lý |
| payments | Giao dịch thu gốc, phương thức, tài khoản, mã tham chiếu, thời điểm |
| payment_allocations | Phân bổ từng khoản thu vào đơn và lịch sử điều chỉnh |
| refunds | Khoản hoàn, nguồn tiền, lý do, người duyệt, trạng thái, tham chiếu |
| tickets, check_ins | Vé riêng, token được bảo vệ, hiệu lực và lịch sử lên xe |
| outbox_events, notifications | Sự kiện cần gửi, kênh, lần thử và trạng thái |
| audit_logs | Người thao tác, thời điểm, đối tượng và thay đổi |

Ràng buộc tối thiểu:

- UNIQUE trên (trip_id, seat_id) của trip_seats; giữ lịch sử riêng khi thay chủ giữ.
- UNIQUE trên (provider, receiving_account, provider_transaction_id) khi nhà cung cấp đảm bảo phạm vi đó; xác nhận lại hợp đồng ID khi tích hợp.
- Mã đơn, mã vé và mã thanh toán không trùng trong phạm vi sử dụng.
- Số tiền nguyên, không âm; kiểm tra giới hạn phân bổ/hoàn bằng giao dịch và khóa bản ghi liên quan.
- Không xóa dây chuyền dữ liệu tài chính khi xóa/ẩn khách hàng hoặc cấu hình.
- Phiên bản sơ đồ, giá và chính sách của đơn phải tái dựng được sau thay đổi cấu hình.

## 11. API dự kiến

Các endpoint là bản phác thảo để thiết kế chi tiết; chưa phải hợp đồng API đã triển khai.

| Phương thức và đường dẫn | Mục đích |
| --- | --- |
| GET /api/v1/trips | Tìm chuyến đang bán |
| GET /api/v1/trips/:id/seats | Xem trạng thái chỗ, không trả dữ liệu hành khách |
| POST /api/v1/bookings | Tạo đơn và giữ chỗ nguyên tử, nhận Idempotency-Key |
| GET /api/v1/bookings/:id | Xem đơn sau xác minh quyền/token |
| POST /api/v1/bookings/:id/payment-requests | Tạo/lấy yêu cầu thanh toán, chống tạo lặp |
| POST /api/v1/ticket-lookups/challenges | Bắt đầu xác minh tra cứu, giới hạn tần suất |
| POST /api/v1/ticket-lookups/verify | Xác minh OTP/token và cấp quyền tra cứu có hạn |
| POST /api/v1/webhooks/payments/:provider | Nhận sự kiện đã xác thực |
| POST /api/v1/admin/bookings | Nhân viên đặt hộ vào cùng kho chỗ |
| POST /api/v1/admin/bookings/:id/change | Đổi vé theo quyền và chính sách |
| POST /api/v1/admin/bookings/:id/cancel | Hủy toàn bộ hoặc một phần |
| POST /api/v1/admin/cash-receipts | Ghi nhận tiền mặt, chống ghi hai lần |
| POST /api/v1/admin/refunds | Tạo yêu cầu hoàn |
| POST /api/v1/admin/refunds/:id/approve | Duyệt hoàn theo quyền |
| POST /api/v1/admin/tickets/:id/check-in | Xác nhận lên xe, chống lặp |
| GET /api/v1/admin/reports/collections | Báo cáo thu và khoản phải thu |

Phản hồi lỗi cần mã ổn định như SEAT_UNAVAILABLE, HOLD_EXPIRED, PAYMENT_REVIEW_REQUIRED; thông điệp khách đọc được bằng tiếng Việt. Không đưa số điện thoại hoặc token bí mật vào URL truy vấn có thể bị ghi log.

## 12. Bảo mật và vận hành

- HTTPS; bí mật tích hợp lưu phía máy chủ trong kho cấu hình an toàn.
- Đường dẫn vé khó đoán, có thể thu hồi; tra cứu không chỉ dựa vào số điện thoại hoặc mã tăng dần.
- OTP có hạn, giới hạn số lần nhập/gửi; tránh tiết lộ khách có đặt vé hay không qua phản hồi công khai.
- Không yêu cầu CCCD hoặc dữ liệu nhạy cảm khác khi chưa có nhu cầu nghiệp vụ và cơ sở áp dụng được xác minh.
- Tách quyền xem khách, thu tiền, đối soát và duyệt hoàn; che bớt thông tin trong log.
- Sao lưu tự động, thử phục hồi; theo dõi lỗi giữ chỗ, webhook, outbox, đối soát và gửi thông báo.
- Chính sách lưu dữ liệu, quyền truy cập và yêu cầu pháp lý về dữ liệu cá nhân, bán vé, thông báo/hóa đơn cần được xác minh trước vận hành; tài liệu này không kết luận nghĩa vụ pháp lý cụ thể.
- Có quy trình sự cố: tạm ngừng tạo đơn mới khi không đảm bảo kho chỗ; tiếp tục xử lý giao dịch vào và đối soát; công bố trạng thái rõ ràng cho khách.
- Khi nhà xe bán thủ công do mất mạng, phải có quy trình khóa/phân bổ kho chỗ trước; không cho phép bán ngoài hệ thống vào chỗ online vẫn đang mở.

Mục tiêu thử nghiệm ban đầu, cần điều chỉnh bằng dự báo lưu lượng thực: 200 người dùng đồng thời duyệt/tìm chuyến và 50 yêu cầu đồng thời tranh một chỗ; chỉ một đơn được giữ chỗ. Mục tiêu không bán trùng là yêu cầu bắt buộc, không phải tỷ lệ chấp nhận lỗi.

## 13. Kiểm thử và nghiệm thu

| Mã | Tình huống | Điều kiện đạt |
| --- | --- | --- |
| AC-01 | Nhiều khách giữ cùng chỗ | Chỉ một đơn giữ được; các đơn khác nhận lỗi rõ ràng |
| AC-02 | Đơn nhiều chỗ có một chỗ vừa hết | Không giữ một phần hoặc thu tiền cho nhóm thiếu chỗ |
| AC-03 | Hết hạn giữ | Chỗ được bán lại an toàn; đơn cũ không tự xác nhận |
| AC-04 | Thanh toán đủ cọc trong hạn | Một bộ vé hợp lệ, số còn thiếu đúng |
| AC-05 | Thanh toán và hết hạn đồng thời | Kết quả nhất quán, không bán trùng; tiền được ghi nhận |
| AC-06 | Webhook trùng hoặc sai thứ tự | Không cộng tiền/phát vé/gửi thông báo trùng |
| AC-07 | Webhook giả hoặc sai tài khoản | Không xác nhận tiền và vé |
| AC-08 | Chuyển thiếu, dư hoặc nhiều lần | Phân bổ và số dư đúng; có luồng xử lý ngoại lệ |
| AC-09 | Chuyển tiền sau khi chỗ đã bán lại | Không lấy lại chỗ; tiền vào danh sách cần xử lý |
| AC-10 | Webhook bị bỏ lỡ | Đối soát phát hiện và xử lý không trùng |
| AC-11 | Gửi email/SMS lỗi, worker khởi động lại | Vé vẫn tồn tại; sự kiện được gửi lại có kiểm soát |
| AC-12 | Nhân viên và khách đặt cùng lúc | Dùng chung kho chỗ, không bán trùng |
| AC-13 | Thu tiền mặt/hoàn bị bấm hai lần | Chỉ ghi một lần; không hoàn vượt giới hạn |
| AC-14 | Hủy một vé trong đơn nhóm | Chỉ ảnh hưởng đúng hành khách, chỗ và số tiền |
| AC-15 | Đổi xe ít chỗ hơn | Chặn hoàn tất nếu chưa giải quyết khách chưa có chỗ |
| AC-16 | Người không có quyền truy cập vé/báo cáo | Bị từ chối, không rò dữ liệu |
| AC-17 | Khôi phục bản sao lưu | Đối chiếu được đơn, chỗ, tiền và sự kiện còn chờ |

Chạy thử với nhân viên trên một tuyến và lượng vé giới hạn. Chỉ mở bán rộng sau khi kiểm thử cạnh tranh chỗ, đối soát tiền và quy trình hỗ trợ đạt yêu cầu. Giao dịch thử dùng môi trường mô phỏng nếu dịch vụ hỗ trợ; mọi thử nghiệm tiền thật cần được chủ tài khoản cho phép riêng.

## 14. Lộ trình và chi phí

### 14.1. Lộ trình dự kiến

| Giai đoạn | Thời lượng tham khảo | Kết quả |
| --- | --- | --- |
| Khảo sát nghiệp vụ | 1 tuần | Tuyến, sơ đồ xe, giá, chính sách và quy trình thu |
| Thiết kế trải nghiệm/dữ liệu | 1–2 tuần | Nguyên mẫu đặt vé, quản trị, trạng thái nghiệp vụ |
| Xây nền tảng đặt vé | 2–3 tuần | Chuyến, kho chỗ, đặt online/đặt hộ, phân quyền |
| Thanh toán và thông báo | 2–3 tuần | Ghi nhận tiền, đối soát, vé, email/SMS |
| Kiểm thử và chạy thử | 2–3 tuần | Kiểm thử tải, phục hồi, hướng dẫn và vận hành giới hạn |

Một số việc có thể song song. Tổng khung lập kế hoạch khoảng 8–12 tuần cho nhóm nhỏ có kinh nghiệm; cần ước lượng lại sau khảo sát và xác nhận nhà cung cấp, không phải cam kết tiến độ.

### 14.2. Nhóm chi phí cần dự toán

- Thiết kế, phát triển, kiểm thử và hỗ trợ triển khai.
- Tên miền, máy chủ, PostgreSQL, sao lưu và giám sát.
- Dịch vụ thanh toán/đối soát theo ngân hàng và gói sử dụng.
- Email, SMS, OTP và thông báo thay đổi chuyến.
- Bảo trì, xử lý sự cố và hỗ trợ cao điểm.

Không ghi mức phí nhà cung cấp cố định trong tài liệu; lấy báo giá tại thời điểm lựa chọn. Dự toán theo lượng đơn, hành khách, số thông báo mỗi đơn và mức tải cao điểm, không chỉ theo số xe.

### 14.3. Chỉ số theo dõi

- Tỷ lệ hoàn tất đặt vé; tỷ lệ hết hạn giữ chỗ.
- Tỷ lệ thanh toán tự khớp và số giao dịch cần xử lý thủ công.
- Độ trễ từ nhận sự kiện tiền đến đến xác nhận vé.
- Số vụ bán trùng: mục tiêu bằng 0.
- Số tiền chưa phân bổ, khoản cần hoàn và thời gian xử lý.
- Tỷ lệ thông báo thành công; số yêu cầu hỗ trợ trên mỗi 100 đơn.

## 15. Những quyết định cần chốt

- Nhà xe và người đại diện xác nhận dữ liệu, vận hành, tài khoản nhận tiền.
- Tuyến, điểm đón/trả, thời gian chạy và địa danh hiển thị hiện hành.
- Sơ đồ xe thực tế, ký hiệu phòng, quy tắc số người mỗi phòng.
- Giá theo ngày/tầng/phòng; phụ thu và chính sách trẻ em nếu có.
- Cọc theo tỷ lệ hay số tiền; ngày nào trả đủ; hạn giữ và hạn thu phần còn lại.
- Đổi/hủy, phí, thời hạn, xử lý khách vắng mặt và chuyến bị hủy.
- Chuyển thiếu/chuyển muộn có được cấp lại chỗ và ai phê duyệt.
- Ngân hàng, nhà cung cấp thanh toán, email/SMS và người chịu phí.
- Người được thu tiền, khớp giao dịch, duyệt và thực hiện hoàn.
- Ngày mở bán cao điểm, lưu lượng dự kiến và quy trình trực hỗ trợ.

Các mục này được chuyển thành cấu hình hoặc chính sách có phiên bản trước khi mở bán. Không dùng dữ liệu minh họa làm cam kết với khách.

## 16. Nguồn tham khảo

Các nguồn dưới đây đã được tham khảo trong trao đổi ngày 01/11/2026; tính năng, điều kiện và phí cần kiểm tra lại khi tích hợp.

- [FUTA — Website tham khảo](https://futabus.vn/).
- [FUTA — Hướng dẫn đặt vé trên web](https://futabus.vn/huong-dan-dat-ve-tren-web): tham khảo trình tự chọn hành trình, chỗ, thông tin khách và thanh toán.
- [SePay — Webhook](https://developer.sepay.vn/vi/sepay-webhooks): thông báo giao dịch ngân hàng tới máy chủ.
- [SePay — Bảo mật webhook](https://developer.sepay.vn/vi/sepay-webhooks/bao-mat): xác thực và kiểm tra dữ liệu.
- [SePay — Đối soát giao dịch](https://developer.sepay.vn/vi/sepay-webhooks/doi-soat-giao-dich): xử lý giao dịch bị thiếu khi nhận webhook.
- [payOS — Webhook thông tin thanh toán](https://payos.vn/docs/du-lieu-tra-ve/webhook/).
- [payOS — Kiểm tra chữ ký](https://payos.vn/docs/tich-hop-webhook/kiem-tra-du-lieu-voi-signature/).

Ảnh Phong Nhung do người dùng cung cấp là tham chiếu thương hiệu ban đầu. Kiến trúc, mô hình dữ liệu, API và quy tắc vận hành trong tài liệu là đề xuất thiết kế của dự án, không phải mô tả hệ thống nội bộ của FUTA hay cam kết của các nhà cung cấp.
