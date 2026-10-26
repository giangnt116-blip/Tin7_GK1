import { foldVietnamese, normalizeVietnameseName } from './nameMatcher.js';

/**
 * Filter and rank students based on diacritic-sensitive, diacritic-insensitive,
 * continuous unaccented name, student ID, STT and partial name queries.
 *
 * Examples:
 * - "Ngô Minh Nhật" -> matches
 * - "Ngo Minh Nhat" -> matches
 * - "ngominhnhat" -> matches
 * - "minh nhat" -> matches
 * - "7A1_01" or "01" or "1" -> matches
 */
export function filterStudents(students = [], query = '') {
  if (!query || !query.trim()) {
    return students;
  }

  const qRaw = query.trim();
  const qLower = qRaw.toLowerCase();
  const qFold = foldVietnamese(qRaw).trim().toLowerCase();
  const qNorm = normalizeVietnameseName(qRaw);
  const qCleanNum = qRaw.replace(/^0+/, '');

  const words = qFold.split(/\s+/).filter(Boolean);

  const scored = [];

  for (const st of students) {
    const nameLower = (st.name || '').toLowerCase();
    const nameFold = foldVietnamese(st.name || '').toLowerCase();
    const nameNorm = st.normalized || normalizeVietnameseName(st.name || '');
    const sId = (st.studentId || '').toLowerCase();
    const stt = String(st.originalIndex || '');

    let score = -1;

    // Exact matches (Highest priority)
    if (sId === qLower || sId === qFold) {
      score = 1000;
    } else if (nameLower === qLower || nameFold === qFold || nameNorm === qNorm) {
      score = 900;
    }
    // Student ID prefix or contains
    else if (sId.startsWith(qLower) || sId.startsWith(qFold)) {
      score = 800;
    } else if (sId.includes(qLower) || sId.includes(qFold)) {
      score = 750;
    }
    // STT match (e.g. "01" or "1")
    else if (qCleanNum && (stt === qCleanNum || sId.endsWith(`_${qRaw}`) || sId.endsWith(`_0${qRaw}`))) {
      score = 700;
    }
    // Full name prefix
    else if (nameLower.startsWith(qLower) || nameFold.startsWith(qFold)) {
      score = 600;
    }
    // Full name contains
    else if (nameLower.includes(qLower) || nameFold.includes(qFold)) {
      score = 500;
    }
    // Continuous unaccented text contains (e.g. "ngominhnhat" or "minhnhat")
    else if (qNorm && nameNorm.includes(qNorm)) {
      score = 450;
    }
    // All individual words present (order-independent)
    else if (words.length > 0 && words.every((w) => nameFold.includes(w) || nameNorm.includes(w))) {
      score = 400;
    }

    if (score >= 0) {
      scored.push({ student: st, score });
    }
  }

  // Sort by score descending, then by original STT ascending
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (a.student.originalIndex || 0) - (b.student.originalIndex || 0);
  });

  return scored.map((s) => s.student);
}
