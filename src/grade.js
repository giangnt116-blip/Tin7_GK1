export const MAX = [1, 2, 1, 3, 3];
export const cap = (x, m) => Math.max(0, Math.min(m, Math.round((Number(x) || 0) * 4) / 4));
export const sum = (a) => Math.round(a.reduce((s, x) => s + Number(x || 0), 0) * 100) / 100;
export const fold = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
export const key = (s) => fold(s).replace(/[^a-z0-9]/g, '');

export function classify(files) {
  const paths = files.map((f) =>
    fold(f.submissionRelativePath || f.path || f.name).replace(/\\/g, '/')
  );
  const images = files.filter((f) =>
    /\.(png|jpg|jpeg|gif|webp|bmp)$/i.test(f.fileName || f.name)
  );
  const docs = files.filter((f) =>
    /\.(docx|doc|txt|pdf)$/i.test(f.fileName || f.name)
  );
  const answer =
    docs.find((f) => /dap[_ -]?an/i.test(fold(f.fileName || f.name))) || docs[0];

  const dir1 = paths.some(
    (p) => p.includes('01_') || p.includes('01-') || p.startsWith('01/')
  );
  const dir2 = paths.some(
    (p) => p.includes('02_') || p.includes('02-') || p.startsWith('02/')
  );
  const imageIn02 = images.filter((f) => {
    const p = fold(f.submissionRelativePath || f.path || '');
    return p.includes('02_') || p.includes('02-') || p.startsWith('02/');
  });
  const hasDANANG = images.some((f) => {
    const k = key(f.fileName || f.name);
    return (
      k.includes('danang') ||
      k.includes('caurong') ||
      k.includes('bana') ||
      k.includes('songhan')
    );
  });

  const evidence = [
    `${dir1 ? 'Có' : 'Chưa nhận diện'} thư mục 01 (Văn bản); ${
      dir2 ? 'có' : 'chưa nhận diện'
    } thư mục 02 (Hình ảnh)`,
    `${images.length} ảnh; ${imageIn02.length} ảnh trong thư mục 02; ${
      hasDANANG ? 'chủ đề Đà Nẵng phù hợp' : 'chưa thấy tên Da_Nang'
    }`,
    answer
      ? `Tìm thấy tệp trả lời: ${answer.submissionRelativePath || answer.path || answer.name}`
      : 'Chưa tìm thấy tệp trả lời',
    'TC4: đối chiếu 5 ý kiến thức (AI hoặc GV duyệt)',
    `Tổng ${files.length} tệp (${images.length} ảnh, ${docs.length} văn bản)`,
  ];

  return {
    evidence,
    files,
    answer,
    images,
    flags: [dir1, dir2, imageIn02.length > 0, hasDANANG],
  };
}

export function matchStudent(label, roster) {
  const q = key(label.replace(/^(gk1|tin7|lop7|7a\d+)[_\s-]*/gi, ''));
  if (!q) return null;
  const matches = roster.filter((name) => q.includes(key(name)) || key(name).includes(q));
  return matches.length === 1 ? matches[0] : null;
}

export function validatedScores(scores) {
  return MAX.map((m, i) => cap(scores?.[i], m));
}
