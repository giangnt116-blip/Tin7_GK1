import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
import { createExtractorFromData } from 'node-unrar-js';
import { normalizeEntriesToSubmissionTrees } from '../src/submissionTree.js';
import { classify, validatedScores, sum } from '../src/grade.js';
import { matchStudentAdvanced, buildEnrichedRoster } from '../src/nameMatcher.js';

const roster = JSON.parse(fs.readFileSync('data/roster.json', 'utf-8'));
const enrichedRoster = buildEnrichedRoster(roster);

async function testParity() {
  console.log('--- BẮT ĐẦU KIỂM THỬ TƯƠNG ĐƯƠNG FOLDER - ZIP - RAR ---');

  // 1. FOLDER INPUT
  const folderEntries = [
    {
      name: 'Dap_an_Tin7.docx',
      path: 'GK1_TIN7_NGOMINHNHAT/01_VAN_BAN/Dap_an_Tin7.docx',
      size: 12000,
      textContent: 'Ngô Minh Nhật - 7A5. 1A: Sai. 1B: Micro vao. 1C: Loa ra. 2A: MP3 la tep am thanh. 2B: Teams.',
    },
    {
      name: 'Da_Nang_Cau_Rong.jpg',
      path: 'GK1_TIN7_NGOMINHNHAT/02_HINH_ANH/Da_Nang_Cau_Rong.jpg',
      size: 100,
    },
    {
      name: 'Da_Nang_Ba_Na.jpg',
      path: 'GK1_TIN7_NGOMINHNHAT/02_HINH_ANH/Da_Nang_Ba_Na.jpg',
      size: 100,
    },
  ];

  const folderTrees = normalizeEntriesToSubmissionTrees(folderEntries, 'Folder', 'GK1_TIN7_NGOMINHNHAT');
  const folderBatch = folderTrees[0];

  // 2. ZIP INPUT
  const zipBuffer = fs.readFileSync('public/sample_submissions/GK1_TIN7_NGOMINHNHAT.zip');
  const zip = await JSZip.loadAsync(zipBuffer);
  const zipEntries = [];
  for (const [filename, file] of Object.entries(zip.files)) {
    if (file.dir) continue;
    zipEntries.push({
      name: path.basename(filename),
      path: filename,
      size: (await file.async('uint8array')).length,
      textContent: filename.endsWith('.docx')
        ? 'Ngô Minh Nhật - 7A5. 1A: Sai. 1B: Micro vao. 1C: Loa ra. 2A: MP3 la tep am thanh. 2B: Teams.'
        : '',
    });
  }

  const zipTrees = normalizeEntriesToSubmissionTrees(zipEntries, 'ZIP', 'GK1_TIN7_NGOMINHNHAT.zip');
  const zipBatch = zipTrees[0];

  // 3. RAR INPUT
  const rarBuffer = fs.readFileSync('public/sample_submissions/GK1_TIN7_NGOMINHNHAT.rar');
  const arrayBuffer = rarBuffer.buffer.slice(rarBuffer.byteOffset, rarBuffer.byteOffset + rarBuffer.byteLength);
  const extractor = await createExtractorFromData({ data: arrayBuffer });
  const rarFiles = extractor.extract();
  const rarEntries = [];
  for (const f of [...rarFiles.files]) {
    if (f.fileHeader.flags.directory) continue;
    rarEntries.push({
      name: path.basename(f.fileHeader.name),
      path: f.fileHeader.name,
      size: f.fileHeader.unpSize,
      textContent: f.fileHeader.name.endsWith('.docx')
        ? 'Ngô Minh Nhật - 7A5. 1A: Sai. 1B: Micro vao. 1C: Loa ra. 2A: MP3 la tep am thanh. 2B: Teams.'
        : '',
    });
  }

  const rarTrees = normalizeEntriesToSubmissionTrees(rarEntries, 'RAR', 'GK1_TIN7_NGOMINHNHAT.rar');
  const rarBatch = rarTrees[0];

  // COMPARE PATHS
  const folderPaths = folderBatch.fileTree.map((f) => f.submissionRelativePath).sort();
  const zipPaths = zipBatch.fileTree.map((f) => f.submissionRelativePath).sort();
  const rarPaths = rarBatch.fileTree.map((f) => f.submissionRelativePath).sort();

  console.log('Folder Paths:', folderPaths);
  console.log('ZIP Paths:   ', zipPaths);
  console.log('RAR Paths:   ', rarPaths);

  const pathsEqual =
    JSON.stringify(folderPaths) === JSON.stringify(zipPaths) &&
    JSON.stringify(zipPaths) === JSON.stringify(rarPaths);

  console.log('Paths Identical:', pathsEqual);

  // CLASSIFY & SCORE
  const folderClassify = classify(folderBatch.fileTree);
  const zipClassify = classify(zipBatch.fileTree);
  const rarClassify = classify(rarBatch.fileTree);

  console.log('Folder Flags:', folderClassify.flags);
  console.log('ZIP Flags:   ', zipClassify.flags);
  console.log('RAR Flags:   ', rarClassify.flags);

  const flagsEqual =
    JSON.stringify(folderClassify.flags) === JSON.stringify(zipClassify.flags) &&
    JSON.stringify(zipClassify.flags) === JSON.stringify(rarClassify.flags);

  // STUDENT MATCHING
  const folderMatch = matchStudentAdvanced(folderBatch.studentLabel, folderBatch.fileTree, enrichedRoster, '7A5');
  const zipMatch = matchStudentAdvanced(zipBatch.studentLabel, zipBatch.fileTree, enrichedRoster, '7A5');
  const rarMatch = matchStudentAdvanced(rarBatch.studentLabel, rarBatch.fileTree, enrichedRoster, '7A5');

  console.log('Student match:');
  console.log('Folder:', folderMatch.studentName, folderMatch.studentId, folderMatch.status);
  console.log('ZIP:   ', zipMatch.studentName, zipMatch.studentId, zipMatch.status);
  console.log('RAR:   ', rarMatch.studentName, rarMatch.studentId, rarMatch.status);

  const matchEqual =
    folderMatch.studentId === zipMatch.studentId &&
    zipMatch.studentId === rarMatch.studentId &&
    folderMatch.studentId === '7A5_19';

  console.log('--- KẾT QUẢ KIỂM THỬ: ---');
  console.log('Paths Equal: ', pathsEqual);
  console.log('Flags Equal: ', flagsEqual);
  console.log('Match Equal: ', matchEqual);

  if (pathsEqual && flagsEqual && matchEqual) {
    console.log('=> THÀNH CÔNG: Cả 3 định dạng Folder, ZIP, RAR cho kết quả nhận diện và phân tích hoàn toàn đồng nhất!');
  } else {
    console.error('=> THẤT BẠI: Có sự khác biệt giữa các định dạng!');
    process.exit(1);
  }
}

testParity().catch(console.error);
