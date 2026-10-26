import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX, validatedScores, sum, classify } from './grade.js';
import { normalizeVietnameseName, calculateSimilarity, foldVietnamese, buildEnrichedRoster } from './nameMatcher.js';
import { filterStudents } from './studentFilter.js';

test('không vượt tối đa', () => assert.deepEqual(validatedScores([2, 5, 4, 9, 7]), MAX));
test('tổng điểm', () => assert.equal(sum([1, 2, 1, 2.75, 3]), 9.75));

test('thuật toán chuẩn hóa tiếng Việt normalizeVietnameseName', () => {
  assert.equal(normalizeVietnameseName('Ngô Minh Nhật'), 'ngominhnhat');
  assert.equal(normalizeVietnameseName('NGOMINHNHAT'), 'ngominhnhat');
  assert.equal(normalizeVietnameseName('Nguyen_Thanh_An_Tin7.zip'), 'nguyenthanhan');
  assert.equal(normalizeVietnameseName('TRAN-BAO-NAM.rar'), 'tranbaonam');
  assert.equal(normalizeVietnameseName('GK1_Lê Bá Duy Đức.docx'), 'lebaduyduc');
});

test('tính điểm tương đồng Levenshtein & Dice', () => {
  assert.equal(calculateSimilarity('nguyenthanhan', 'nguyenthanhan'), 100);
  const diff1 = calculateSimilarity('buinhatlinh', 'buinhatlihn');
  assert.ok(diff1 >= 85 && diff1 < 100, 'Sai 1 ký tự phải đạt trên 85%');
});

test('không tự chấm thư mục', () => {
  let r = classify([{ name: 'Da_Nang.png', path: 'HS/02_HINH_ANH/Da_Nang.png' }]);
  assert.ok(r.evidence[0].includes('Chưa nhận diện'));
  assert.equal(r.images.length, 1);
});

test('bộ lọc tìm kiếm học sinh filterStudents thông minh', () => {
  const sampleStudents = [
    { studentId: '7A1_01', name: 'Lã Quỳnh Anh', normalized: 'laquynhanh', originalIndex: 1 },
    { studentId: '7A1_02', name: 'Nguyễn Lê Gia Bảo', normalized: 'nguyenlegiabao', originalIndex: 2 },
    { studentId: '7A1_18', name: 'Bùi Nhật Linh', normalized: 'buinhatlinh', originalIndex: 18 },
    { studentId: '7A1_19', name: 'Ngô Võ Thùy Linh', normalized: 'ngovothuylinh', originalIndex: 19 },
    { studentId: '7A1_20', name: 'Ngô Minh Nhật', normalized: 'ngominhnhat', originalIndex: 20 },
  ];

  // 1. Tìm theo tên tiếng Việt có dấu
  const r1 = filterStudents(sampleStudents, 'Ngô Minh Nhật');
  assert.equal(r1.length, 1);
  assert.equal(r1[0].studentId, '7A1_20');

  // 2. Tìm theo tên không dấu có khoảng trắng
  const r2 = filterStudents(sampleStudents, 'Ngo Minh Nhat');
  assert.equal(r2.length, 1);
  assert.equal(r2[0].studentId, '7A1_20');

  // 3. Tìm theo tên không dấu viết liền
  const r3 = filterStudents(sampleStudents, 'ngominhnhat');
  assert.equal(r3.length, 1);
  assert.equal(r3[0].studentId, '7A1_20');

  // 4. Tìm theo tên đệm + tên riêng
  const r4 = filterStudents(sampleStudents, 'minh nhat');
  assert.equal(r4.length, 1);
  assert.equal(r4[0].studentId, '7A1_20');

  // 5. Tìm theo mã học sinh
  const r5 = filterStudents(sampleStudents, '7A1_20');
  assert.equal(r5.length, 1);
  assert.equal(r5[0].studentId, '7A1_20');

  // 6. Tìm theo STT trong lớp ("20")
  const r6 = filterStudents(sampleStudents, '20');
  assert.equal(r6.length, 1);
  assert.equal(r6[0].studentId, '7A1_20');

  // 7. Tìm theo STT có số 0 ở đầu ("01")
  const r7 = filterStudents(sampleStudents, '01');
  assert.equal(r7[0].studentId, '7A1_01');

  // 8. Nhiều học sinh trùng tên riêng ("Linh"): hiển thị đầy đủ, không tự chọn 1 người
  const r8 = filterStudents(sampleStudents, 'Linh');
  assert.equal(r8.length, 2);
  assert.ok(r8.some((s) => s.name === 'Bùi Nhật Linh'));
  assert.ok(r8.some((s) => s.name === 'Ngô Võ Thùy Linh'));
});

