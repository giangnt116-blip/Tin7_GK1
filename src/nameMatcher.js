/**
 * Module Thuật toán Chuẩn hóa tiếng Việt và Ghép tên học sinh - FPT Tin Grader 7
 */

// 1. Chuẩn hóa Unicode NFD, xóa dấu thanh & dấu phụ, chuyển đ/Đ -> d, chuyển chữ thường
export function foldVietnamese(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase();
}

// 2. Thuật toán normalizeVietnameseName() theo đúng Mục 4
export function normalizeVietnameseName(raw) {
  if (!raw) return '';
  let s = foldVietnamese(raw);

  // Xóa phần mở rộng tệp
  s = s.replace(/\.(zip|rar|docx|doc|txt|pdf|png|jpg|jpeg|webp|bmp)$/gi, '');

  // Xóa các phần nhiễu không thuộc tên: Tin7, GKI, GK1, BaiThi, BaiNop, BaiTap, Lop7, 7A..., năm học
  s = s.replace(
    /\b(tin\s*7|gk\s*1|gk\s*i|giua\s*ky\s*1|bai\s*thi|bai\s*nop|bai\s*lam|bai\s*tap|lop\s*7|7a\d+|202[0-9]|203[0-9]|dap\s*an)\b/gi,
    ''
  );
  s = s.replace(/(tin7|gk1|gki|baithi|bainop|bailam|baitap|lop7|7a\d+)/gi, '');

  // Loại bỏ các ký tự phân cách: _, -, khoảng trắng, dấu chấm, số thứ tự đầu
  s = s.replace(/^\d+[\s_-]*/, ''); // Bỏ số thứ tự đầu nếu có (vd 01_, 02_)
  s = s.replace(/[^a-z0-9]/g, '');

  return s;
}

// Tính khoảng cách Levenshtein giữa 2 chuỗi
export function levenshteinDistance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const d = Array.from({ length: a.length + 1 }, () =>
    new Array(b.length + 1).fill(0)
  );

  for (let i = 0; i <= a.length; i++) d[i][0] = i;
  for (let j = 0; j <= b.length; j++) d[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1, // xóa
        d[i][j - 1] + 1, // chèn
        d[i - 1][j - 1] + cost // thay thế
      );
      if (
        i > 1 &&
        j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1]
      ) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1); // hoán vị liền kề
      }
    }
  }
  return d[a.length][b.length];
}

// Tính độ tương đồng Dice Bigram kết hợp Levenshtein (0 - 100%)
export function calculateSimilarity(s1, s2) {
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 100;

  const maxLen = Math.max(s1.length, s2.length);
  if (maxLen === 0) return 100;

  const levDist = levenshteinDistance(s1, s2);
  const levScore = ((maxLen - levDist) / maxLen) * 100;

  // Dice bigrams
  if (s1.length < 2 || s2.length < 2) {
    return Math.round(levScore);
  }

  const bigrams1 = new Set();
  for (let i = 0; i < s1.length - 1; i++) {
    bigrams1.add(s1.slice(i, i + 2));
  }
  let intersection = 0;
  for (let i = 0; i < s2.length - 1; i++) {
    if (bigrams1.has(s2.slice(i, i + 2))) {
      intersection++;
    }
  }
  const diceScore =
    (2 * intersection) / (s1.length - 1 + (s2.length - 1)) * 100;

  // Điểm trung bình có trọng số (60% Levenshtein, 40% Dice)
  const combined = Math.round(levScore * 0.6 + diceScore * 0.4);
  return Math.max(0, Math.min(100, combined));
}

// Tạo danh mục học sinh có định danh studentId chính thức
export function buildEnrichedRoster(rawRoster) {
  const enriched = {};
  for (const [className, studentList] of Object.entries(rawRoster)) {
    enriched[className] = (studentList || []).map((name, idx) => {
      const studentId = `${className}_${String(idx + 1).padStart(2, '0')}`;
      const normalized = normalizeVietnameseName(name);
      const parts = foldVietnamese(name).trim().split(/\s+/);
      const firstName = parts.at(-1) || '';
      return {
        studentId,
        name,
        className,
        normalized,
        firstName,
        originalIndex: idx + 1,
      };
    });
  }
  return enriched;
}

/**
 * Trích xuất các chuỗi tên tiềm năng từ nhãn nhóm, tên file và đường dẫn
 */
export function extractCandidateTokens(label, files = []) {
  const candidates = new Set();

  // 1. Từ chính nhãn nhóm / tên file nén gốc
  const normLabel = normalizeVietnameseName(label);
  if (normLabel) candidates.add(normLabel);

  // Thử trích xuất phần trước dấu gạch dưới / gạch ngang
  const labelParts = label.split(/[/\\_-]+/);
  for (const p of labelParts) {
    const np = normalizeVietnameseName(p);
    if (np && np.length >= 4) candidates.add(np);
  }

  // 2. Từ các tệp bên trong
  for (const f of files.slice(0, 10)) {
    const p = f.path || f.name || '';
    const segs = p.split(/[/\\_-]+/);
    for (const seg of segs) {
      const nSeg = normalizeVietnameseName(seg);
      if (nSeg && nSeg.length >= 4) {
        candidates.add(nSeg);
      }
    }
  }

  return Array.from(candidates);
}

/**
 * Thuật toán ghép tên theo 3 tầng ưu tiên chuẩn
 */
export function matchStudentAdvanced(label, files = [], enrichedRoster, currentClass) {
  const classStudents = enrichedRoster[currentClass] || [];
  const candidateTokens = extractCandidateTokens(label, files);

  // 1. Ưu tiên 1: Khớp mã học sinh chính thức (VD: 7A1_01, 7A1-01, 7A101)
  const cleanLabelFold = foldVietnamese(label).replace(/[^a-z0-9]/g, '');
  for (const st of classStudents) {
    const cleanId = foldVietnamese(st.studentId).replace(/[^a-z0-9]/g, '');
    if (cleanLabelFold.includes(cleanId)) {
      return {
        matchedStudent: st,
        studentId: st.studentId,
        studentName: st.name,
        targetClass: currentClass,
        similarity: 100,
        priority: 'Ưu tiên 1 (Khớp mã HS)',
        status: 'Đã tự ghép',
        reason: `Khớp trực tiếp mã định danh học sinh [${st.studentId}]`,
      };
    }
  }

  // 2. Ưu tiên 2: Khớp chính xác tên đầy đủ sau chuẩn hóa (duy nhất trong lớp)
  for (const token of candidateTokens) {
    const exactMatches = classStudents.filter((st) => st.normalized === token);
    if (exactMatches.length === 1) {
      const st = exactMatches[0];
      return {
        matchedStudent: st,
        studentId: st.studentId,
        studentName: st.name,
        targetClass: currentClass,
        similarity: 100,
        priority: 'Ưu tiên 2 (Khớp chính xác tên)',
        status: 'Đã tự ghép',
        reason: `Khớp chính xác 100% với tên có dấu "${st.name}" (${st.studentId})`,
      };
    } else if (exactMatches.length > 1) {
      // Trùng tên trong cùng lớp -> CẦN XÁC NHẬN, không tự gán bừa
      return {
        matchedStudent: null,
        studentId: null,
        studentName: '',
        targetClass: currentClass,
        similarity: 100,
        priority: 'Ưu tiên 2 (Trùng tên)',
        status: 'Cần xác nhận',
        reason: `Trùng tên không dấu [${token}] với ${exactMatches.length} học sinh trong lớp: ${exactMatches.map((x) => x.name).join(', ')}. Không được tự gán.`,
        candidates: exactMatches,
      };
    }
  }

  // Thử khớp chuỗi chứa (VD: token chứa toàn bộ normalized name của học sinh)
  for (const token of candidateTokens) {
    const containsMatches = classStudents.filter(
      (st) => token.includes(st.normalized) || st.normalized.includes(token)
    );
    if (containsMatches.length === 1) {
      const st = containsMatches[0];
      // Nếu token quá ngắn (dưới 4 ký tự - chỉ là tên riêng như An, Nam) -> Cần xác nhận
      if (token.length <= 4 && st.normalized.length > 6) {
        return {
          matchedStudent: null,
          studentId: null,
          studentName: '',
          targetClass: currentClass,
          similarity: 70,
          priority: 'Ưu tiên 3 (Tên riêng đơn lẻ)',
          status: 'Cần xác nhận',
          reason: `Tên nộp chỉ có từ riêng ngắn "${token}", cần giáo viên xác nhận để tránh nhầm lẫn.`,
          candidates: containsMatches,
        };
      }

      return {
        matchedStudent: st,
        studentId: st.studentId,
        studentName: st.name,
        targetClass: currentClass,
        similarity: 98,
        priority: 'Ưu tiên 2 (Khớp chuỗi tên)',
        status: 'Đã tự ghép',
        reason: `Khớp trọn vẹn họ và tên với "${st.name}" (${st.studentId})`,
      };
    } else if (containsMatches.length > 1) {
      return {
        matchedStudent: null,
        studentId: null,
        studentName: '',
        targetClass: currentClass,
        similarity: 85,
        priority: 'Ưu tiên 3 (Nhiều ứng viên)',
        status: 'Cần xác nhận',
        reason: `Có ${containsMatches.length} học sinh phù hợp (${containsMatches.map((x) => x.name).join(', ')}). Giáo viên vui lòng chọn chính xác.`,
        candidates: containsMatches,
      };
    }
  }

  // 3. Ưu tiên 3: So khớp gần đúng (Fuzzy Match với Levenshtein & Dice)
  let bestCandidate = null;
  let bestSim = 0;
  let secondSim = 0;

  for (const token of candidateTokens) {
    if (token.length < 5) continue; // Bỏ qua token quá ngắn để tránh nhận vơ
    for (const st of classStudents) {
      const sim = calculateSimilarity(token, st.normalized);
      if (sim > bestSim) {
        secondSim = bestSim;
        bestSim = sim;
        bestCandidate = st;
      } else if (sim > secondSim) {
        secondSim = sim;
      }
    }
  }

  // Điều kiện tự ghép gần đúng: Điểm >= 95% VÀ cách biệt ít nhất 15% so với ứng viên thứ 2
  if (bestCandidate && bestSim >= 95 && bestSim - secondSim >= 15) {
    return {
      matchedStudent: bestCandidate,
      studentId: bestCandidate.studentId,
      studentName: bestCandidate.name,
      targetClass: currentClass,
      similarity: bestSim,
      priority: 'Ưu tiên 3 (Khớp gần đúng cao)',
      status: 'Đã tự ghép',
      reason: `Độ tương đồng rất cao ${bestSim}% với "${bestCandidate.name}" (sai khác nhẹ, cách biệt rõ với ứng viên khác).`,
    };
  }

  if (bestCandidate && bestSim >= 80) {
    return {
      matchedStudent: null,
      studentId: null,
      studentName: '',
      suggestedStudent: bestCandidate,
      targetClass: currentClass,
      similarity: bestSim,
      priority: 'Ưu tiên 3 (Gần giống, cần duyệt)',
      status: 'Cần xác nhận',
      reason: `Gần giống ${bestSim}% với học sinh "${bestCandidate.name}". Giáo viên vui lòng xác nhận.`,
    };
  }

  // 4. Kiểm tra nộp nhầm lớp: Dò trong các lớp khác của khối 7
  for (const [otherClass, otherStudents] of Object.entries(enrichedRoster)) {
    if (otherClass === currentClass) continue;
    for (const token of candidateTokens) {
      const otherMatches = otherStudents.filter(
        (st) => st.normalized === token || (token.length >= 8 && token.includes(st.normalized))
      );
      if (otherMatches.length === 1) {
        const otherSt = otherMatches[0];
        return {
          matchedStudent: null,
          studentId: null,
          studentName: '',
          wrongClassStudent: otherSt,
          targetClass: otherClass,
          similarity: 100,
          priority: 'Cảnh báo nộp nhầm lớp',
          status: 'Cần xác nhận',
          reason: `Cảnh báo: Có thể nộp nhầm lớp! Tìm thấy học sinh trùng khớp "${otherSt.name}" thuộc lớp ${otherClass}.`,
        };
      }
    }
  }

  // 5. Không tìm thấy
  return {
    matchedStudent: null,
    studentId: null,
    studentName: '',
    targetClass: currentClass,
    similarity: 0,
    priority: 'Không tìm thấy',
    status: 'Không tìm thấy',
    reason: 'Không nhận diện được tên học sinh tương ứng trong danh sách lớp.',
  };
}
