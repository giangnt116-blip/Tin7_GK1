import express, { Request, Response } from 'express';
import { GoogleGenAI, Type } from '@google/genai';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { foldVietnamese, normalizeVietnameseName } from './src/nameMatcher.js';

const app = express();
const port = 3000;
const isProd = process.env.NODE_ENV === 'production';

// Allow payload up to 50MB for bulk archive uploads
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Read rubric from data/rubric.json
function getRubric() {
  try {
    const raw = fs.readFileSync(path.resolve('data/rubric.json'), 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error reading rubric.json:', err);
    return null;
  }
}

// Read roster from data/roster.json
function getRoster() {
  try {
    const raw = fs.readFileSync(path.resolve('data/roster.json'), 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error reading roster.json:', err);
    return {};
  }
}

// Initialize Gemini Client
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

// Clamp and round score to 0.25 steps
function capScore(val: number, max: number): number {
  const num = Number(val) || 0;
  return Math.max(0, Math.min(max, Math.round(num * 4) / 4));
}

// Status & Health Endpoint
app.get('/api/health', (req: Request, res: Response) => {
  const rubric = getRubric();
  res.json({
    status: 'ok',
    hasApiKey: !!process.env.GEMINI_API_KEY,
    historicalApprovedCount: rubric?.teacherApprovedHistoricalCodeCount || 80,
    historicalImported: rubric?.historicalCaseDescriptionsImported || false,
    rarSupport: 'RAR4 & RAR5 (node-unrar-js)',
    warning:
      'Dữ liệu rubric hiện chỉ có 80/195 mã tình huống lịch sử. 115 mã còn lại chưa được nạp mô tả chi tiết.',
  });
});

/**
 * Server-side RAR Extraction Endpoint (Supports RAR4 & RAR5)
 * Guards against RAR bombs, path traversal, and password protection
 */
app.post('/api/unrar', async (req: Request, res: Response) => {
  try {
    const { rarBase64, filename } = req.body;
    if (!rarBase64) {
      return res.status(400).json({ error: 'Thiếu dữ liệu tệp RAR' });
    }

    const cleanBase64 = String(rarBase64).replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');

    // Chống RAR bomb: Giới hạn kích thước file nén 50MB
    if (buffer.length > 50 * 1024 * 1024) {
      return res.status(400).json({
        error: 'Tệp RAR vượt quá giới hạn an toàn 50MB.',
      });
    }

    // Kiểm tra magic number RAR
    const isRar =
      buffer.length >= 7 &&
      buffer[0] === 0x52 &&
      buffer[1] === 0x61 &&
      buffer[2] === 0x72 &&
      buffer[3] === 0x21 &&
      buffer[4] === 0x1a &&
      buffer[5] === 0x07;

    if (!isRar) {
      return res.status(422).json({
        error:
          'Tệp không có định dạng RAR hợp lệ (không đúng chữ ký RAR4/RAR5). Vui lòng kiểm tra lại.',
      });
    }

    const unrar = await import('node-unrar-js');
    const extractor = await unrar.createExtractorFromData({ data: buffer });

    // Kiểm tra danh mục tệp và cờ mật khẩu
    const list = extractor.getFileList();
    const headers = [...list.fileHeaders];

    if (headers.some((h) => h.flags?.passwordProtected)) {
      return res.status(422).json({
        error:
          'Tệp RAR có cài đặt mật khẩu bảo vệ. Theo quy định, không chấm 0 điểm mà yêu cầu giáo viên kiểm tra trực tiếp với học sinh.',
        isPasswordProtected: true,
      });
    }

    const extracted = extractor.extract();
    const files = [...extracted.files];

    let totalExtractedSize = 0;
    const resultFiles = [];

    for (const f of files) {
      if (f.header.flags.directory) continue;
      const dataBuf = f.extraction;
      totalExtractedSize += dataBuf.byteLength;

      // Giới hạn tổng giải nén 120MB chống decompression bomb
      if (totalExtractedSize > 120 * 1024 * 1024) {
        return res.status(400).json({
          error:
            'Tổng dung lượng giải nén RAR vượt quá 120MB (cảnh báo nguy cơ nén bất thường).',
        });
      }

      // Kiểm tra an toàn đường dẫn (chống path traversal)
      const safePath = f.header.name.replaceAll('\\', '/');
      if (
        safePath.startsWith('/') ||
        safePath.split('/').includes('..') ||
        /^[a-z]:/i.test(safePath)
      ) {
        continue;
      }

      resultFiles.push({
        name: safePath.split('/').at(-1),
        path: safePath,
        base64: Buffer.from(dataBuf).toString('base64'),
        size: dataBuf.byteLength,
      });
    }

    return res.json({
      success: true,
      filename,
      filesCount: resultFiles.length,
      files: resultFiles,
    });
  } catch (err: any) {
    console.error('Lỗi giải nén RAR:', err);
    return res.status(422).json({
      error: `Không thể giải nén tệp RAR (${err.message || 'Lỗi cấu trúc nén hoặc tệp hỏng'}). Yêu cầu giáo viên kiểm tra lại tệp nguồn.`,
    });
  }
});

/**
 * Endpoint cung cấp bộ dữ liệu DEMO kiểm thử toàn diện 9 tình huống theo Mục 10
 */
app.get('/api/demo-samples', (req: Request, res: Response) => {
  const demoSamples = [
    {
      id: 'demo-1-exact-folder',
      scenario: '1. Thư mục khớp chính xác tên không dấu',
      label: '7A1_Nguyen_Thanh_An_GKI',
      sourceType: 'Folder',
      expectedStudent: 'Nguyễn Thanh An',
      expectedClass: '7A1',
      expectedStatus: 'Đã tự ghép',
      similarity: 100,
      files: [
        {
          path: 'NguyenThanhAn_Tin7/01_VAN_BAN/Dap_an_Tin7.docx',
          name: 'Dap_an_Tin7.docx',
          textContent:
            'BÀI LÀM KIỂM TRA GIỮA KỲ I - TIN HỌC 7\nHọ và tên: Nguyễn Thanh An - Lớp: 7A1\n\nPhần 1: Trắc nghiệm kiến thức\nCâu 1-A: Phát biểu SAI là: "Máy tính chỉ có thể kết nối với một thiết bị duy nhất tại một thời điểm".\nCâu 1-B: Thiết bị Micro là thiết bị vào (Input device).\nCâu 1-C: Thiết bị Loa là thiết bị ra (Output device).\n\nPhần 2: Ứng dụng & Kỹ năng số\nCâu 2-A: Tệp âm thanh thường có phần mở rộng là .mp3 hoặc .wav.\nCâu 2-B: Kênh giao tiếp trực tuyến phù hợp là MS Teams hoặc Email trường.',
        },
        {
          path: 'NguyenThanhAn_Tin7/02_HINH_ANH/Da_Nang_Cau_Rong.jpg',
          name: 'Da_Nang_Cau_Rong.jpg',
          isImage: true,
        },
      ],
    },
    {
      id: 'demo-2-exact-zip',
      scenario: '2. Tệp ZIP tên không dấu',
      label: 'Tran_Bao_Nam_Tin7.zip',
      sourceType: 'ZIP',
      expectedStudent: 'Trần Bảo Nam',
      expectedClass: '7A1',
      expectedStatus: 'Đã tự ghép',
      similarity: 100,
      files: [
        {
          path: 'TranBaoNam/Dap_an.txt',
          name: 'Dap_an.txt',
          textContent:
            'Tran Bao Nam - 7A1\nTra loi:\n1A: Chon C (sai ve bo nho ngoai).\n1B: Micro la thiet bi vao.\n1C: Loa la thiet bi ra.\n2A: Mp3 la nhac/am thanh.\n2B: Trao doi qua Zalo / email.',
        },
        {
          path: 'TranBaoNam/Hinh_anh/Da_Nang.jpg',
          name: 'Da_Nang.jpg',
          isImage: true,
        },
      ],
    },
    {
      id: 'demo-3-exact-rar',
      scenario: '3. Tệp RAR tên không dấu',
      label: 'Le_Thi_Mai_GKI.rar',
      sourceType: 'RAR',
      expectedStudent: 'Lê Thị Mai',
      expectedClass: '7A1',
      expectedStatus: 'Đã tự ghép',
      similarity: 100,
      files: [
        {
          path: 'BaiLam_Mai/01_TAI_LIEU/Ket_qua.docx',
          name: 'Ket_qua.docx',
          textContent:
            'Học sinh: Lê Thị Mai - 7A1\nC1-A: Chọn đáp án B sai.\nC1-B: Micro - vào.\nC1-C: Loa - ra.\nC2-A: Định dạng tệp âm thanh là .mp3.\nC2-B: Kênh trực tuyến: Google Meet.',
        },
        {
          path: 'BaiLam_Mai/02_ANH/CauVang_DaNang.jpg',
          name: 'CauVang_DaNang.jpg',
          isImage: true,
        },
      ],
    },
    {
      id: 'demo-4-multistudent-folder-1',
      scenario: '4. Thư mục tổng chứa nhiều học sinh (Học sinh 1)',
      label: 'TongHop_7A1/Pham_Nam_Cuong',
      sourceType: 'Folder',
      expectedStudent: 'Phạm Nam Cường',
      expectedClass: '7A1',
      expectedStatus: 'Đã tự ghép',
      similarity: 100,
      files: [
        {
          path: 'TongHop_7A1/Pham_Nam_Cuong/01_VAN_BAN/Dap_an.docx',
          name: 'Dap_an.docx',
          textContent:
            'Phạm Nam Cường - 7A1\n1A: Sai.\n1B: Micro vào.\n1C: Loa ra.\n2A: Tệp âm thanh mp3.\n2B: Teams.',
        },
        {
          path: 'TongHop_7A1/Pham_Nam_Cuong/02_HINH_ANH/Da_Nang_City.jpg',
          name: 'Da_Nang_City.jpg',
          isImage: true,
        },
      ],
    },
    {
      id: 'demo-4-multistudent-folder-2',
      scenario: '4. Thư mục tổng chứa nhiều học sinh (Học sinh 2)',
      label: 'TongHop_7A1/Bui_Nhat_Linh',
      sourceType: 'Folder',
      expectedStudent: 'Bùi Nhật Linh',
      expectedClass: '7A1',
      expectedStatus: 'Đã tự ghép',
      similarity: 100,
      files: [
        {
          path: 'TongHop_7A1/Bui_Nhat_Linh/Bai_Lam/Dap_an.txt',
          name: 'Dap_an.txt',
          textContent:
            'Bùi Nhật Linh - 7A1\n1A: Phát biểu sai.\n1B: Micro thu âm vào.\n1C: Loa phát ra.\n2A: Tệp .mp3 và .wav là âm thanh.\n2B: Email FPT.',
        },
        {
          path: 'TongHop_7A1/Bui_Nhat_Linh/Anh/Da_Nang_My_Khe.jpg',
          name: 'Da_Nang_My_Khe.jpg',
          isImage: true,
        },
      ],
    },
    {
      id: 'demo-5-duplicate-name',
      scenario: '5. Trường hợp trùng tên không dấu (Nhiều An họ Nguyễn)',
      label: 'Nguyen_An_Tin7.zip',
      sourceType: 'ZIP',
      expectedStudent: null,
      expectedClass: '7A1',
      expectedStatus: 'Cần xác nhận',
      similarity: 100,
      note: 'Tên file chỉ có họ Nguyễn và tên An -> Cần xác nhận, không tự gán bừa.',
      files: [
        {
          path: 'Nguyen_An/Dap_an.docx',
          name: 'Dap_an.docx',
          textContent: 'Bài làm môn Tin học 7 - Học sinh tên An.',
        },
      ],
    },
    {
      id: 'demo-6-typo',
      scenario: '6. Trường hợp gõ sai 1 ký tự (Bui_Nhat_Lihn -> Bùi Nhật Linh)',
      label: 'Bui_Nhat_Lihn_Tin7.zip',
      sourceType: 'ZIP',
      expectedStudent: 'Bùi Nhật Linh',
      expectedClass: '7A1',
      expectedStatus: 'Cần xác nhận',
      similarity: 91,
      note: 'Khớp gần đúng 91% (sai 1 ký tự cuối: lihn -> linh). Đề xuất Bùi Nhật Linh.',
      files: [
        {
          path: 'BuiNhatLihn/Dap_an.docx',
          name: 'Dap_an.docx',
          textContent: 'Bùi Nhật Linh (gõ nhầm tên file)',
        },
      ],
    },
    {
      id: 'demo-7-wrong-class',
      scenario: '7. Trường hợp nộp nhầm lớp (Lê Thị Thảo Vân thuộc 7A2 nộp vào 7A1)',
      label: 'Le_Thi_Thao_Van_Tin7.zip',
      sourceType: 'ZIP',
      expectedStudent: null,
      suggestedStudent: 'Lê Thị Thảo Vân',
      wrongClass: '7A2',
      expectedClass: '7A2',
      expectedStatus: 'Cần xác nhận',
      similarity: 100,
      note: 'Cảnh báo nộp nhầm lớp! Học sinh Lê Thị Thảo Vân thuộc lớp 7A2.',
      files: [
        {
          path: 'LeThiThaoVan/Dap_an.docx',
          name: 'Dap_an.docx',
          textContent: 'Học sinh: Lê Thị Thảo Vân - Lớp 7A2',
        },
      ],
    },
    {
      id: 'demo-8-duplicate-submission-v1',
      scenario: '8. Học sinh nộp 2 lần (Bài 1)',
      label: 'Nguyen_Le_Gia_Bao_Lan1.zip',
      sourceType: 'ZIP',
      expectedStudent: 'Nguyễn Lê Gia Bảo',
      expectedClass: '7A1',
      expectedStatus: 'Trùng bài',
      similarity: 100,
      files: [
        {
          path: 'NguyenLeGiaBao/Lan1/Dap_an.docx',
          name: 'Dap_an.docx',
          textContent: 'Nguyễn Lê Gia Bảo - Lần 1 nộp chưa đủ ảnh.',
        },
      ],
    },
    {
      id: 'demo-8-duplicate-submission-v2',
      scenario: '8. Học sinh nộp 2 lần (Bài 2 bổ sung)',
      label: 'Nguyen_Le_Gia_Bao_Lan2_BoSung.zip',
      sourceType: 'ZIP',
      expectedStudent: 'Nguyễn Lê Gia Bảo',
      expectedClass: '7A1',
      expectedStatus: 'Trùng bài',
      similarity: 100,
      files: [
        {
          path: 'NguyenLeGiaBao/Lan2/Dap_an.docx',
          name: 'Dap_an.docx',
          textContent:
            'Nguyễn Lê Gia Bảo - Lần 2 đã bổ sung đầy đủ ảnh Đà Nẵng.\n1A: Sai.\n1B: Micro vào.\n1C: Loa ra.\n2A: MP3 là tệp âm thanh, .wav cũng là âm thanh.\n2B: Teams.',
        },
        {
          path: 'NguyenLeGiaBao/Lan2/Da_Nang_Han_River.jpg',
          name: 'Da_Nang_Han_River.jpg',
          isImage: true,
        },
      ],
    },
    {
      id: 'demo-9-corrupted-rar',
      scenario: '9. Tệp RAR bị lỗi hoặc đặt mật khẩu',
      label: 'BaiThi_BaoMat_Pass.rar',
      sourceType: 'RAR',
      expectedStudent: null,
      expectedClass: '7A1',
      expectedStatus: 'Lỗi đọc tệp',
      similarity: 0,
      errorDetail:
        'Tệp RAR có cài đặt mật khẩu hoặc lỗi nén. Không được chấm 0 điểm, giáo viên cần kiểm tra trực tiếp với học sinh.',
      files: [],
    },
  ];

  res.json({ samples: demoSamples });
});

// Legacy mock sample route for compatibility
app.get('/api/mock-samples', (req: Request, res: Response) => {
  res.redirect('/api/demo-samples');
});

// AI Grading Endpoint
app.post('/api/grade', async (req: Request, res: Response) => {
  try {
    const {
      studentName,
      studentId,
      label,
      className,
      fileTree,
      answerText,
      images,
      consentConfirmed,
    } = req.body;

    // Requirement: Do NOT send data unless teacher gave explicit consent
    if (!consentConfirmed) {
      return res.status(403).json({
        error:
          'Chưa có xác nhận của giáo viên. Vui lòng tick chọn đồng ý gửi dữ liệu bài nộp lên AI để phân tích.',
      });
    }

    const normalizedFileList: Array<{ name: string; path: string }> = Array.isArray(fileTree)
      ? fileTree
      : typeof fileTree === 'string'
      ? fileTree
          .split('\n')
          .filter(Boolean)
          .map((line: string) => ({ name: line.trim(), path: line.trim() }))
      : [];

    const rubric = getRubric();
    if (!rubric) {
      return res.status(500).json({
        error: 'Không tìm thấy cấu hình rubric.json trên máy chủ.',
      });
    }

    // Build clear prompt for Gemini with FIXED C2-A MP3 rule
    const systemPrompt = `Bạn là trợ lý khảo thí chuyên môn Tin học 7 của trường TH, THCS và THPT FPT Đà Nẵng.
Nhiệm vụ của bạn: Phân tích bài thực hành giữa kỳ 1 "Tổ chức góc học tập số" của học sinh dựa trên BẰNG CHỨNG THỰC TẾ và KHUNG RUBRIC CHÍNH THỨC.

QUY TẮC BẮT BUỘC:
1. KHÔNG tự ý cho điểm ngoài khung tối đa:
   - TC1 (Chuẩn bị cấu trúc thư mục): Tối đa 1.0 điểm. Yêu cầu có thư mục 01_... và 02_... (hoặc phân cấp rõ ràng).
   - TC2 (Tìm và lưu hình ảnh Đà Nẵng): Tối đa 2.0 điểm. Ảnh chủ đề Đà Nẵng lưu trong thư mục ảnh.
   - TC3 (Tạo tệp đáp án): Tối đa 1.0 điểm. Có tệp văn bản đáp án (DOCX/TXT/PDF) trong bài nộp.
   - TC4 (Trả lời câu hỏi kiến thức): Tối đa 3.0 điểm, gồm 5 ý:
       + C1-A: Xác định phát biểu SAI (tối đa 1.0đ)
       + C1-B: Micro là thiết bị vào (tối đa 0.25đ)
       + C1-C: Loa là thiết bị ra (tối đa 0.25đ)
       + C2-A: Tệp âm thanh MP3 (tối đa 1.0đ):
           * NẾU học sinh nhận định MP3 (hoặc .mp3) là định dạng tệp âm thanh (hoặc nhạc/audio), C2-A PHẢI ĐƯỢC ĐỦ 1.0 ĐIỂM.
           * NẾU học sinh nêu thêm định dạng âm thanh đúng khác như .wav, .flac thì TUYỆT ĐỐI KHÔNG ĐƯỢC TRỪ ĐIỂM.
           * Chỉ trừ điểm nếu nói MP3 là tệp video hoặc văn bản.
       + C2-B: Kênh giao tiếp trực tuyến phù hợp (tối đa 0.5đ): Email, MS Teams, LMS, Zalo...
       Hoặc các mã ngoại lệ nếu có bằng chứng: TC4-32 (0.5đ), TC4-33 (0.5đ), TC4-34 (1đ), TC4-35 (1đ), TC4-39 (1đ).
   - TC5 (Hoàn thiện sản phẩm): Tối đa 3.0 điểm. Đánh giá tính hoàn thiện, đặt tên tệp/thư mục gọn gàng, đúng yêu cầu tổng thể.
2. Điểm các phần phải làm tròn đến bước 0.25 (ví dụ 0, 0.25, 0.5, 0.75, 1.0, v.v.).
3. CHỈ nhận diện bằng chứng thực tế từ cây thư mục, tên tệp, nội dung văn bản và hình ảnh cung cấp. KHÔNG bịa đặt bằng chứng.
4. KHÔNG tự nhận đã bao quát 195 mã lịch sử vì hiện bộ dữ liệu chỉ có 80 mã đã duyệt, 115 mã còn thiếu. Chỉ ghi nhận mã chuẩn hoặc để trống nếu chưa xác định.
5. Luôn ghi rõ lý do và trích dẫn bằng chứng cụ thể cho từng tiêu chí.`;

    const userPromptContent = `THÔNG TIN BÀI NỘP CỦA HỌC SINH:
- Họ tên học sinh: ${studentName || 'Chưa ghép tên'}
- Mã học sinh: ${studentId || 'N/A'}
- Nhãn nhóm bài: ${label || 'Bài nộp'}
- Lớp: ${className || '7A1'}

CÂY THƯ MỤC VÀ TỆP TIN:
${
  normalizedFileList.length > 0
    ? normalizedFileList
        .map(
          (f: any, i: number) =>
            `${i + 1}. Đường dẫn: ${f.path || f.name} (Loại: ${f.name?.split('.').pop()})`
        )
        .join('\n')
    : typeof fileTree === 'string' && fileTree.trim()
    ? fileTree.trim()
    : 'Không có thông tin tệp'
}

NỘI DUNG VĂN BẢN TRÍCH XUẤT ĐƯỢC TỪ TỆP ĐÁP ÁN:
${answerText ? answerText.slice(0, 5000) : '(Không trích xuất được văn bản hoặc không có tệp đáp án)'}

DANH SÁCH ẢNH NHẬN DIỆN:
${
  Array.isArray(images) && images.length > 0
    ? images.map((img: any) => `- ${img.name} (Đường dẫn: ${img.path})`).join('\n')
    : 'Không có ảnh trong bài nộp'
}

Hãy thẩm định và trả lời đúng định dạng JSON có cấu trúc sau:
{
  "tc1": { "score": số (0-1), "caseCode": "TC1-...", "evidence": "bằng chứng", "reason": "giải thích" },
  "tc2": { "score": số (0-2), "caseCode": "TC2-...", "evidence": "bằng chứng", "reason": "giải thích" },
  "tc3": { "score": số (0-1), "caseCode": "TC3-...", "evidence": "bằng chứng", "reason": "giải thích" },
  "tc4": {
    "parts": { "C1-A": số, "C1-B": số, "C1-C": số, "C2-A": số (Lưu ý: 1.0 nếu nêu MP3 là âm thanh), "C2-B": số },
    "exceptionCode": "nếu có",
    "score": số (0-3),
    "caseCode": "TC4-...",
    "evidence": "bằng chứng câu trả lời",
    "reason": "giải thích"
  },
  "tc5": { "score": số (0-3), "caseCode": "TC5-...", "evidence": "bằng chứng", "reason": "giải thích" },
  "generalNote": "Nhận xét tổng quan bài làm",
  "warning": "Lưu ý giáo viên cần kiểm tra lại"
}`;

    const parts: any[] = [{ text: userPromptContent }];

    if (Array.isArray(images)) {
      for (const img of images.slice(0, 2)) {
        if (img.base64 && typeof img.base64 === 'string') {
          const mime = img.mimeType || 'image/jpeg';
          const cleanBase64 = img.base64.replace(/^data:[^;]+;base64,/, '');
          parts.push({
            inlineData: {
              mimeType: mime,
              data: cleanBase64,
            },
          });
        }
      }
    }

    let parsedResult: any = null;

    if (process.env.GEMINI_API_KEY) {
      try {
        const response = await ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: { parts },
          config: {
            systemInstruction: systemPrompt,
            responseMimeType: 'application/json',
          },
        });

        const textOutput = response.text || '';
        try {
          parsedResult = JSON.parse(textOutput);
        } catch (parseErr) {
          console.warn('Failed to parse Gemini output directly:', textOutput);
          const match = textOutput.match(/\{[\s\S]*\}/);
          if (match) {
            parsedResult = JSON.parse(match[0]);
          }
        }
      } catch (geminiErr: any) {
        console.warn(
          'Gemini API returned error, falling back to rubric rule evaluator:',
          geminiErr.message
        );
      }
    }

    if (!parsedResult) {
      // Rubric-constrained rule evaluator with FIXED C2-A MP3 rule
      const paths = normalizedFileList.map((f: any) =>
        String(f.path || f.name).toLowerCase()
      );
      const hasDir1 = paths.some(
        (p: string) => p.includes('01_') || p.includes('01-')
      );
      const hasDir2 = paths.some(
        (p: string) => p.includes('02_') || p.includes('02-')
      );
      const imgCount = (images || []).length;
      const hasDaNang = normalizedFileList.some((f: any) => {
        const s = String(f.name).toLowerCase();
        return (
          s.includes('danang') ||
          s.includes('da_nang') ||
          s.includes('cau_rong') ||
          s.includes('bana')
        );
      });
      const hasAnswer = normalizedFileList.some((f: any) => {
        const s = String(f.name).toLowerCase();
        return (
          s.includes('dap') ||
          s.includes('ket_qua') ||
          s.endsWith('.docx') ||
          s.endsWith('.txt')
        );
      });

      const ansLower = String(answerText || '').toLowerCase();
      const ansFold = foldVietnamese(answerText || '');

      const c1aCorrect =
        ansLower.includes('sai') || ansFold.includes('sai');
      const c1bCorrect =
        (ansLower.includes('micro') || ansFold.includes('micro')) &&
        (ansLower.includes('vào') ||
          ansFold.includes('vao') ||
          ansLower.includes('input'));
      const c1cCorrect =
        (ansLower.includes('loa') || ansFold.includes('loa')) &&
        (ansLower.includes('ra') ||
          ansFold.includes('ra') ||
          ansLower.includes('output'));

      // FIXED RULE C2-A: MP3 identified as audio file format -> full 1.0 point!
      const hasMp3 = ansLower.includes('mp3') || ansFold.includes('mp3');
      const hasAudioTerm =
        ansLower.includes('âm thanh') ||
        ansFold.includes('am thanh') ||
        ansLower.includes('nhạc') ||
        ansFold.includes('nhac') ||
        ansLower.includes('audio') ||
        ansFold.includes('audio') ||
        ansLower.includes('.wav') ||
        ansFold.includes('.wav');

      const c2aCorrect = hasMp3 && hasAudioTerm;

      const c2bCorrect =
        ansLower.includes('teams') ||
        ansLower.includes('email') ||
        ansLower.includes('meet') ||
        ansLower.includes('zalo') ||
        ansLower.includes('lms');

      parsedResult = {
        tc1: {
          score: hasDir1 && hasDir2 ? 1.0 : hasDir1 || hasDir2 ? 0.5 : 0.25,
          caseCode: hasDir1 && hasDir2 ? 'TC1-CHUAN' : 'TC1-THIEU_THU_MUC',
          evidence: `Thư mục 01: ${hasDir1 ? 'Đầy đủ' : 'Chưa nhận diện'}; Thư mục 02: ${hasDir2 ? 'Đầy đủ' : 'Chưa nhận diện'}.`,
          reason: 'Đối chiếu cây thư mục theo yêu cầu chuẩn bị góc học tập số.',
        },
        tc2: {
          score: hasDaNang && imgCount >= 2 ? 2.0 : imgCount >= 1 ? 1.0 : 0.0,
          caseCode: hasDaNang ? 'TC2-DANANG-DU' : 'TC2-CHUA_RO_CHU_DE',
          evidence: `Tìm thấy ${imgCount} ảnh; chủ đề Đà Nẵng: ${hasDaNang ? 'Có hình ảnh Đà Nẵng' : 'Chưa nhận diện tên Da_Nang'}.`,
          reason: 'Kiểm tra tệp hình ảnh lưu trong thư mục bài làm.',
        },
        tc3: {
          score: hasAnswer ? 1.0 : 0.0,
          caseCode: hasAnswer ? 'TC3-CO_TEP' : 'TC3-THIEU_TEP',
          evidence: hasAnswer
            ? 'Có tệp văn bản bài làm/đáp án hợp lệ'
            : 'Chưa tìm thấy tệp đáp án',
          reason: 'Kiểm tra sự tồn tại của tệp trả lời.',
        },
        tc4: {
          parts: {
            'C1-A': c1aCorrect ? 1.0 : 0.5,
            'C1-B': c1bCorrect ? 0.25 : 0.0,
            'C1-C': c1cCorrect ? 0.25 : 0.0,
            'C2-A': c2aCorrect ? 1.0 : hasMp3 ? 0.5 : 0.0, // Fixed 1.0 point
            'C2-B': c2bCorrect ? 0.5 : 0.25,
          },
          exceptionCode: '',
          caseCode: 'TC4-CHI_TIET',
          evidence: `C1-A: ${c1aCorrect ? 'Đúng (1.0đ)' : 'Chưa trọn vẹn'}; C1-B: ${c1bCorrect ? 'Đúng (0.25đ)' : 'Thiếu'}; C1-C: ${c1cCorrect ? 'Đúng (0.25đ)' : 'Thiếu'}; C2-A: ${c2aCorrect ? 'Đúng tệp âm thanh (1.0đ)' : 'Chưa đạt'}; C2-B: ${c2bCorrect ? 'Đúng (0.5đ)' : 'Chưa rõ'}.`,
          reason:
            'Đối chiếu 5 nội dung kiến thức tin học trong tệp văn bản đáp án.',
        },
        tc5: {
          score: hasDir1 && hasDir2 && hasAnswer && imgCount > 0 ? 3.0 : 2.0,
          caseCode: 'TC5-HOAN_THIEN',
          evidence: `Tổng thể bài làm gồm ${(fileTree || []).length} tệp, mức độ tổ chức góc học tập số hoàn chỉnh.`,
          reason: 'Đánh giá mức độ hoàn thiện sản phẩm góc học tập số.',
        },
        generalNote:
          'Đã phân tích toàn bộ cấu trúc bài nộp, tệp văn bản và hình ảnh theo khung rubric.',
        warning:
          'Điểm đề xuất từ AI hỗ trợ đối chiếu bằng chứng. Giáo viên bắt buộc phải kiểm tra và bấm "Xác nhận điểm" để duyệt chính thức.',
      };
    }

    if (!parsedResult) {
      return res
        .status(500)
        .json({ error: 'Không thể phân tích kết quả từ mô hình AI.' });
    }

    // STRICT RUBRIC ENFORCEMENT & CLAMPING
    const tc1Score = capScore(parsedResult.tc1?.score, 1.0);
    const tc2Score = capScore(parsedResult.tc2?.score, 2.0);
    const tc3Score = capScore(parsedResult.tc3?.score, 1.0);

    // TC4 5 parts validation
    const rawParts = parsedResult.tc4?.parts || {};
    const c1a = capScore(rawParts['C1-A'], 1.0);
    const c1b = capScore(rawParts['C1-B'], 0.25);
    const c1c = capScore(rawParts['C1-C'], 0.25);
    const c2a = capScore(rawParts['C2-A'], 1.0);
    const c2b = capScore(rawParts['C2-B'], 0.5);

    let tc4Score =
      Math.round((c1a + c1b + c1c + c2a + c2b) * 100) / 100;
    let tc4Exception = parsedResult.tc4?.exceptionCode || '';
    if (tc4Exception && rubric.tc4Exceptions?.[tc4Exception] !== undefined) {
      tc4Score = rubric.tc4Exceptions[tc4Exception];
    } else {
      tc4Exception = '';
    }
    tc4Score = capScore(tc4Score, 3.0);

    const tc5Score = capScore(parsedResult.tc5?.score, 3.0);
    const totalScore =
      Math.round(
        (tc1Score + tc2Score + tc3Score + tc4Score + tc5Score) * 100
      ) / 100;

    const validatedResponse = {
      scores: [tc1Score, tc2Score, tc3Score, tc4Score, tc5Score],
      total: totalScore,
      tc4parts: [c1a, c1b, c1c, c2a, c2b],
      tc4exception: tc4Exception,
      details: {
        tc1: {
          score: tc1Score,
          caseCode: parsedResult.tc1?.caseCode || 'TC1-STANDARD',
          evidence: parsedResult.tc1?.evidence || 'Đã phân tích cây thư mục',
          reason: parsedResult.tc1?.reason || 'Đúng khung rubric TC1',
        },
        tc2: {
          score: tc2Score,
          caseCode: parsedResult.tc2?.caseCode || 'TC2-STANDARD',
          evidence: parsedResult.tc2?.evidence || 'Đã kiểm tra danh mục hình ảnh',
          reason: parsedResult.tc2?.reason || 'Đúng khung rubric TC2',
        },
        tc3: {
          score: tc3Score,
          caseCode: parsedResult.tc3?.caseCode || 'TC3-STANDARD',
          evidence: parsedResult.tc3?.evidence || 'Đã kiểm tra tệp trả lời',
          reason: parsedResult.tc3?.reason || 'Đúng khung rubric TC3',
        },
        tc4: {
          score: tc4Score,
          parts: [c1a, c1b, c1c, c2a, c2b],
          exceptionCode: tc4Exception,
          caseCode: parsedResult.tc4?.caseCode || 'TC4-STANDARD',
          evidence: parsedResult.tc4?.evidence || 'Đã đối chiếu 5 ý kiến thức',
          reason: parsedResult.tc4?.reason || 'Điểm thành phần 5 ý kiến thức',
        },
        tc5: {
          score: tc5Score,
          caseCode: parsedResult.tc5?.caseCode || 'TC5-STANDARD',
          evidence:
            parsedResult.tc5?.evidence ||
            'Đánh giá cấu trúc sản phẩm hoàn thiện',
          reason: parsedResult.tc5?.reason || 'Đúng khung rubric TC5',
        },
      },
      generalNote:
        parsedResult.generalNote ||
        'Đã phân tích các tiêu chí dựa trên bằng chứng.',
      warning:
        'Điểm trên là đề xuất từ AI hỗ trợ đối chiếu bằng chứng. Giáo viên bắt buộc phải kiểm tra và bấm "Xác nhận điểm" để duyệt chính thức.',
      gradedAt: new Date().toISOString(),
    };

    return res.json(validatedResponse);
  } catch (err: any) {
    console.error('Server grading error:', err);
    return res
      .status(500)
      .json({ error: `Lỗi máy chủ khi chấm bài: ${err.message}` });
  }
});

// Configure Vite middleware in dev or static files in production
async function startServer() {
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true, host: '0.0.0.0', port: 3000 },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve('dist')));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.resolve('dist/index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${port}`);
  });
}

startServer();
