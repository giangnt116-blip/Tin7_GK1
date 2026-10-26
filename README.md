# FPT Tin Grader 7 — AI Studio / React MVP

**Đã tạo mã nguồn web chạy được** để dùng làm nền tảng trên Google AI Studio, GitHub và các dịch vụ hosting web.

## Chạy thử

```bash
npm install
npm run dev
```

Mở đường dẫn do Vite cung cấp, thường là http://localhost:5173.

## Chức năng đã triển khai

- Tải **Folder** (webkitdirectory) giữ relativePath và **ZIP** (một/nhiều ZIP, hỗ trợ ZIP lồng tối đa 2 cấp); kiểm tra zip-slip và giới hạn 240 MB, 2500 tệp.
- Đọc danh sách 13 lớp từ mẫu trường Tin7, ghép tên học sinh; cho GV sửa nếu nhận dạng chưa chính xác.
- Kiểm tra cấu trúc tệp, xem ảnh, trích nội dung DOCX/TXT, tải file gốc để kiểm tra; giáo viên chấm/duyệt 5 TC.
- TC4 năm ý 1 + .25 + .25 + 1 + .5, hoặc ngoại lệ TC4-32/33/34/35/39 khi GV xác nhận.
- Xuất **phiếu tổng hợp DOCX từ chính file gốc** bằng điền vào ô tương ứng, không tạo mẫu thay thế; xuất XLSX bảng điểm, DOCX phiếu cá nhân và ZIP nhiều phiếu, JSON backup.
- Phải gán tên và duyệt đủ cả 5 TC mới được xuất điểm chính thức. Không tự tạo điểm dựa trên cây thư mục.

## Giới hạn còn lại — CẦN PHÂN BIỆT RÕ

1. Đây là **MVP quản lí, hỗ trợ chấm và xuất phiếu**, CHƯA có Gemini chấm tự động. Lý do: lịch sử 195 mã tình huống chưa được cung cấp dưới dạng dữ liệu máy đọc đầy đủ; không được tự bịa. Có chức năng nhập rubric JSON để cập nhật. Chưa có tài khoản giáo viên / DB / audit log bền vững.
2. Tệp `data/rubric.json` chỉ chứa 5 tiêu chí, 5 ý TC4 và một số ngoại lệ GV đã xác nhận. Con số 80/195 là thông tin lịch sử, **không có nghĩa 80 quy tắc đã được nhập vào JSON**.
3. Phiếu **cá nhân** là phiếu thiết kế mới để in. Phiếu **tổng hợp** dùng đúng DOCX nguồn, điền điểm cho lớp được chọn nhưng giữ nguyên trang của các lớp khác; định dạng bảng và tiêu đề được bảo toàn nhiều nhất có thể.
4. Nhập Folder qua trình duyệt không nhận diện được thư mục rỗng; không nên đưa ra kết luận thiếu/thừa khi chưa có metadata đầy đủ. Đối với ZIP, các thư mục rỗng cũng chưa được bảo lưu trong engine v1.
5. Chọn nhiều file rời được tạo mỗi file một nhóm bài; muốn giữ nguyên một bài nhiều file nên chọn Folder/ZIP.
6. Dữ liệu và điểm chỉ có trong phiên trình duyệt; xuất JSON để sao lưu trước khi đóng tab. Trình duyệt sẽ gửi tệp lên website nếu triển khai app khác phiên bản này; cần xác thực, phân quyền và trường duyệt chính sách dữ liệu trước khi công khai.
7. Nhận diện mã tình huống và tự động chấm bằng Gemini sẽ là **giai đoạn kế tiếp** khi hoàn thiện rubric JSON đầy đủ và backend có API key an toàn. Không đặt GEMINI_API_KEY trong bundle React.

## Đưa vào Google AI Studio

Tại aistudio.google.com > Build, chọn luồng import project / GitHub nếu tài khoản hỗ trợ, hoặc yêu cầu tạo từ prompt và copy các file code vào dự án. Gói ZIP nguồn này là dự án **Vite React** chuẩn, phù hợp đẩy lên GitHub. Không khẳng định rằng mọi phiên bản AI Studio đều trực tiếp import ZIP.

Prompt tiếp tục:

> Hãy bảo toàn toàn bộ giao diện và chức năng React trong repo FPT Tin Grader 7. Chuyển cơ chế rubric hiện tại sang JSON đầy đủ 195 tình huống sau khi tôi cung cấp, đồng thời thêm Gemini ở backend Node an toàn để đề xuất mã tình huống với bằng chứng. Không tự chấm nếu thiếu bằng chứng; không tự tạo điểm đã chốt; giáo viên luôn duyệt điểm trước khi xuất. Bổ sung Firebase Auth/Firestore để lưu kết quả có phân quyền; giữ nguyên chức năng Folder, ZIP và template Word gốc.

## Kiểm thử

```bash
npm test
npm run build
```

Đầu vào kiểm thử sẵn có của dự án trước đây: bài Tin 7 đóng gói ZIP của một học sinh. Nhớ không dùng dữ liệu HS thật trên dịch vụ AI công khai trước khi trường cho phép.
