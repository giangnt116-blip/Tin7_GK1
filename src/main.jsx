import React, { useRef, useState, useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import JSZip from 'jszip';
import mammoth from 'mammoth/mammoth.browser';
import * as XLSX from 'xlsx';
import {
  Document,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  HeadingLevel,
  AlignmentType,
  Packer,
  WidthType,
} from 'docx';
import {
  Upload,
  FolderOpen,
  FileArchive,
  FileDown,
  CheckCircle,
  AlertTriangle,
  ClipboardCheck,
  Search,
  BookOpen,
  ChevronRight,
  RotateCcw,
  Eye,
  Download,
  FileText,
  ShieldCheck,
  Settings,
  Save,
  Bot,
  Play,
  RefreshCw,
  Sparkles,
  Check,
  Lock,
  LockOpen,
  Clock,
  UserCheck,
  Users,
  Copy,
  Layers,
  HelpCircle,
  X,
  FileCheck,
} from 'lucide-react';
import roster from '../data/roster.json';
import initialRubric from '../data/rubric.json';
import {
  MAX,
  cap,
  sum,
  fold,
  key,
  classify,
  matchStudent,
  validatedScores,
} from './grade.js';
import {
  foldVietnamese,
  normalizeVietnameseName,
  calculateSimilarity,
  buildEnrichedRoster,
  matchStudentAdvanced,
} from './nameMatcher.js';
import './style.css';
import StudentCombobox from './StudentCombobox.jsx';

const LABELS = initialRubric.criteria.map((x) => x.label);
const getTotal = (b) => sum(b.scores);

// Build official roster with studentId
const ENRICHED_ROSTER = buildEnrichedRoster(roster);

function download(data, name, mime = 'application/octet-stream') {
  const u = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = document.createElement('a');
  a.href = u;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 2000);
}

function uint8ToBase64(u8) {
  let binary = '';
  const chunkSize = 0x8000; // 32KB chunking avoids call stack limit while processing full file
  const len = u8.length || u8.byteLength;
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = u8.subarray(i, Math.min(i + chunkSize, len));
    binary += String.fromCharCode.apply(null, chunk);
  }
  return window.btoa(binary);
}

async function extractTextFromFile(f) {
  if (!f) return '';
  if (f.textContent) return f.textContent;
  if (!f.data) return '';
  try {
    if (/\.docx$/i.test(f.name)) {
      const r = await mammoth.extractRawText({
        arrayBuffer: f.data.buffer.slice(
          f.data.byteOffset,
          f.data.byteOffset + f.data.byteLength
        ),
      });
      return r.value || '';
    }
    if (/\.txt$/i.test(f.name)) {
      return new TextDecoder('utf-8').decode(f.data);
    }
  } catch (e) {
    console.warn('Text extraction error:', e);
  }
  return '';
}

// Magic number check for archive format
function detectArchiveType(data) {
  if (!data || data.length < 4) return 'unknown';
  if (data[0] === 0x50 && data[1] === 0x4b) return 'zip';
  if (
    data.length >= 7 &&
    data[0] === 0x52 &&
    data[1] === 0x61 &&
    data[2] === 0x72 &&
    data[3] === 0x21 &&
    data[4] === 0x1a &&
    data[5] === 0x07
  ) {
    return 'rar';
  }
  return 'unknown';
}

// Client-side ZIP extraction
async function unzipData(data, prefix = '', depth = 0) {
  if (depth > 2) throw Error('ZIP lồng quá 2 cấp');
  const z = await JSZip.loadAsync(data);
  const items = Object.values(z.files).filter((f) => !f.dir);
  if (items.length > 2500) throw Error('Quá 2500 tệp');
  let total = 0;
  const out = [];
  for (const f of items) {
    let p = f.name.replaceAll('\\', '/');
    if (p.startsWith('/') || p.split('/').includes('..') || /^[a-z]:/i.test(p))
      continue;
    const fData = await f.async('uint8array');
    total += fData.byteLength;
    if (total > 200 * 1024 * 1024 || fData.byteLength > 30 * 1024 * 1024)
      throw Error('ZIP vượt giới hạn 200 MB hoặc 30 MB/tệp');

    const arcType = detectArchiveType(fData);
    if (/\.zip$/i.test(p) || arcType === 'zip') {
      out.push(...(await unzipData(fData, prefix + p.replace(/\.[^.]+$/, '') + '/', depth + 1)));
    } else if (/\.rar$/i.test(p) || arcType === 'rar') {
      out.push(...(await extractRarViaServer(fData, prefix + p.replace(/\.[^.]+$/, '') + '/')));
    } else {
      out.push({ path: prefix + p, name: p.split('/').at(-1), data: fData });
    }
  }
  return out;
}

// Server-side RAR extraction call
async function extractRarViaServer(data, prefix = '') {
  const base64 = uint8ToBase64(data);
  const res = await fetch('/api/unrar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rarBase64: base64, filename: prefix }),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error || 'Lỗi khi giải nén tệp RAR');
  }

  const out = [];
  for (const f of json.files || []) {
    const raw = atob(f.base64);
    const u8 = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      u8[i] = raw.charCodeAt(i);
    }
    out.push({
      path: prefix + f.path,
      name: f.name,
      data: u8,
    });
  }
  return out;
}

const normpath = (p) => p.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');

function groupFiles(entries) {
  const groups = {};
  for (const f of entries) {
    const p = normpath(f.path),
      parts = p.split('/');
    if (parts.some((p) => p === '..')) continue;
    let group = parts.length > 1 ? parts[0] : 'Bài tải riêng';
    if (/^(bai_thi|baitap|tin7|lop7|7a\d+|gk1|gki)$/i.test(group) && parts.length > 2)
      group = parts[1];
    (groups[group] ??= []).push({ ...f, path: p });
  }
  return Object.entries(groups).map(([label, files]) => ({ label, files }));
}

function inferSegments(entries, sourceLabel) {
  let a = groupFiles(entries);
  if (a.length === 1 && a[0].label === 'Bài tải riêng') {
    return [{ label: sourceLabel.replace(/\.(zip|rar)$/i, ''), files: entries }];
  }
  return a;
}

function App() {
  const [cl, setCl] = useState('7A1');
  const [batches, setBatches] = useState([]);
  const [selected, setSelected] = useState(null);
  const [tab, setTab] = useState('upload'); // 'upload' | 'matching' | 'results' | 'exports' | 'config'
  const [loading, setLoading] = useState('');
  const [error, setError] = useState('');
  const [rubric, setRubric] = useState(initialRubric);
  const [statusMessage, setStatusMessage] = useState('');

  // Unified upload staging queue
  const [stagedItems, setStagedItems] = useState([]); // Array of { name, type: 'Folder'|'ZIP'|'RAR', fileObject, webkitFiles }

  // AI & Privacy states
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [batchGrading, setBatchGrading] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });

  // Unlock management
  const [unlockingId, setUnlockingId] = useState(null);
  const [unlockReason, setUnlockReason] = useState('');

  // Tree view modal
  const [treeModalStudent, setTreeModalStudent] = useState(null);

  const folderInputRef = useRef();
  const fileInputRef = useRef();
  const rubricRef = useRef();

  const [viewFile, setViewFile] = useState(null);
  const [fileContent, setFileContent] = useState('');

  const currentClassStudents = useMemo(() => {
    return ENRICHED_ROSTER[cl] || [];
  }, [cl]);

  // Track assigned students across batches to highlight duplicate assignments
  const assignedStudentMap = useMemo(() => {
    const map = {};
    for (const b of batches) {
      if (b.studentId) {
        if (!map[b.studentId]) {
          map[b.studentId] = { batchId: b.id, batchLabel: b.label || b.id };
        }
      }
    }
    return map;
  }, [batches]);

  // Load persisted batches for selected class from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('fpt_tin7_grader_batches_' + cl);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setBatches(parsed);
          setSelected(parsed[0].id);
        }
      }
    } catch (e) {
      console.warn('Cannot load from localStorage:', e);
    }
  }, [cl]);

  // Persist batches to localStorage
  useEffect(() => {
    if (batches.length > 0) {
      try {
        const storable = batches.map((b) => ({
          ...b,
          files: b.files.map((f) => ({
            name: f.name,
            path: f.path,
            textContent: f.textContent || null,
          })),
        }));
        localStorage.setItem(
          'fpt_tin7_grader_batches_' + cl,
          JSON.stringify(storable)
        );
      } catch (e) {
        console.warn('Cannot save to localStorage:', e);
      }
    }
  }, [batches, cl]);

  const current = batches.find((b) => b.id === selected);

  // Statistics calculation
  const approved = batches.filter((b) => b.approved).length;
  const waitingReview = batches.filter(
    (b) => !b.approved && b.status === 'Chờ duyệt'
  ).length;

  // Matching Statistics (Section 5)
  const matchingStats = useMemo(() => {
    const total = batches.length;
    const autoMatched = batches.filter((b) => b.matchStatus === 'Đã tự ghép').length;
    const needsConfirm = batches.filter((b) => b.matchStatus === 'Cần xác nhận').length;
    const notFound = batches.filter(
      (b) => b.matchStatus === 'Không tìm thấy' || b.matchStatus === 'Lỗi đọc tệp'
    ).length;
    const duplicate = batches.filter((b) => b.matchStatus === 'Trùng bài').length;
    const readyToGrade = batches.filter(
      (b) => b.name && b.matchStatus !== 'Trùng bài' && b.matchStatus !== 'Lỗi đọc tệp'
    ).length;

    return { total, autoMatched, needsConfirm, notFound, duplicate, readyToGrade };
  }, [batches]);

  function update(id, patch) {
    setBatches((prev) =>
      prev.map((b) => (b.id === id ? { ...b, ...patch } : b))
    );
  }

  // Handle stage Folder
  function handleStageFolder(fileList) {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    const folderName = files[0]?.webkitRelativePath?.split('/')[0] || 'Thư mục nộp bài';

    setStagedItems((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        name: folderName,
        type: 'Folder',
        filesCount: files.length,
        webkitFiles: files,
      },
    ]);
    setStatusMessage(`Đã thêm thư mục "${folderName}" (${files.length} tệp) vào hàng đợi xử lý.`);
  }

  // Handle stage Archive files (ZIP/RAR)
  function handleStageFiles(fileList) {
    if (!fileList || fileList.length === 0) return;
    const newItems = Array.from(fileList).map((f) => {
      const isRar = /\.rar$/i.test(f.name);
      return {
        id: crypto.randomUUID(),
        name: f.name,
        type: isRar ? 'RAR' : 'ZIP',
        size: (f.size / (1024 * 1024)).toFixed(1) + ' MB',
        fileObject: f,
      };
    });

    setStagedItems((prev) => [...prev, ...newItems]);
    setStatusMessage(`Đã thêm ${newItems.length} tệp nén (ZIP/RAR) vào hàng đợi xử lý.`);
  }

  // Remove single staged item
  function removeStagedItem(id) {
    setStagedItems((prev) => prev.filter((it) => it.id !== id));
  }

  // Clear all staged items
  function clearStagedItems() {
    setStagedItems([]);
  }

  // Core Processing: Unpack, Segment, and Auto-Match
  async function processStagedItems() {
    if (stagedItems.length === 0) {
      setError('Vui lòng chọn ít nhất một Thư mục hoặc Tệp ZIP/RAR trước khi xử lý.');
      return;
    }

    setError('');
    setLoading('Đang giải nén và phân loại bài nộp...');
    try {
      const allExtractedEntries = [];
      const errorRecords = [];

      for (const item of stagedItems) {
        if (item.type === 'Folder') {
          for (const f of item.webkitFiles) {
            const arcType = detectArchiveType(new Uint8Array(await f.slice(0, 8).arrayBuffer()));
            if (/\.zip$/i.test(f.name) || arcType === 'zip') {
              try {
                const subEntries = await unzipData(new Uint8Array(await f.arrayBuffer()), f.webkitRelativePath.replace(/\.[^.]+$/, '') + '/');
                allExtractedEntries.push(...subEntries);
              } catch (zipErr) {
                console.warn('Lỗi giải nén ZIP con:', zipErr);
              }
            } else if (/\.rar$/i.test(f.name) || arcType === 'rar') {
              let fData = null;
              try {
                fData = new Uint8Array(await f.arrayBuffer());
                const subEntries = await extractRarViaServer(fData, f.webkitRelativePath.replace(/\.[^.]+$/, '') + '/');
                allExtractedEntries.push(...subEntries);
              } catch (rarErr) {
                console.warn('Lỗi giải nén RAR con:', rarErr);
                errorRecords.push({
                  label: f.name,
                  sourceType: 'RAR',
                  error: rarErr.message,
                  rawBytes: fData,
                  rawFile: f,
                });
              }
            } else {
              allExtractedEntries.push({
                path: f.webkitRelativePath || f.name,
                name: f.name,
                data: new Uint8Array(await f.arrayBuffer()),
              });
            }
          }
        } else if (item.type === 'ZIP') {
          try {
            const u8 = new Uint8Array(await item.fileObject.arrayBuffer());
            const entries = await unzipData(u8, item.name.replace(/\.[^.]+$/, '') + '/');
            allExtractedEntries.push(...entries);
          } catch (zipErr) {
            errorRecords.push({
              label: item.name,
              sourceType: 'ZIP',
              error: zipErr.message,
            });
          }
        } else if (item.type === 'RAR') {
          let u8 = null;
          try {
            u8 = new Uint8Array(await item.fileObject.arrayBuffer());
            const entries = await extractRarViaServer(u8, item.name.replace(/\.[^.]+$/, '') + '/');
            allExtractedEntries.push(...entries);
          } catch (rarErr) {
            errorRecords.push({
              label: item.name,
              sourceType: 'RAR',
              error: rarErr.message,
              rawBytes: u8,
              rawFile: item.fileObject,
            });
          }
        }
      }

      // Group into student segments
      const segments = inferSegments(allExtractedEntries, 'BaiNop');

      // Create records with Advanced Name Matching
      const newRecords = [];
      const studentSubmissionCount = {};

      for (const seg of segments) {
        const info = classify(seg.files);
        // Determine source type
        const isRar = seg.files.some((f) => /\.rar\//i.test(f.path)) || /\.rar$/i.test(seg.label);
        const isZip = seg.files.some((f) => /\.zip\//i.test(f.path)) || /\.zip$/i.test(seg.label);
        const sourceType = isRar ? 'RAR' : isZip ? 'ZIP' : 'Folder';

        // Advanced Name Matching
        const matchResult = matchStudentAdvanced(seg.label, seg.files, ENRICHED_ROSTER, cl);

        let finalStudentName = matchResult.studentName || '';
        let finalStudentId = matchResult.studentId || null;
        let matchStatus = matchResult.status;

        // Duplicate submission detection (Section 4)
        if (finalStudentId) {
          studentSubmissionCount[finalStudentId] = (studentSubmissionCount[finalStudentId] || 0) + 1;
          if (studentSubmissionCount[finalStudentId] > 1) {
            matchStatus = 'Trùng bài';
          }
        }

        newRecords.push({
          id: crypto.randomUUID(),
          label: seg.label,
          sourceType,
          name: finalStudentName,
          studentId: finalStudentId,
          targetClass: matchResult.targetClass || cl,
          similarity: matchResult.similarity || 0,
          matchStatus,
          matchReason: matchResult.reason,
          suggestedStudent: matchResult.suggestedStudent || null,
          wrongClassStudent: matchResult.wrongClassStudent || null,
          candidates: matchResult.candidates || [],
          files: seg.files,
          info,
          scores: [0, 0, 0, 0, 0],
          approved: false,
          approvedAt: null,
          approvedScores: null,
          auditHistory: [],
          reviewed: [false, false, false, false, false],
          notes: '',
          status: 'Chưa chấm',
          aiResult: null,
          aiError: '',
          tc4parts: [0, 0, 0, 0, 0],
          tc4exception: '',
        });
      }

      // Add corrupted / password error records
      for (const errRec of errorRecords) {
        newRecords.push({
          id: crypto.randomUUID(),
          label: errRec.label,
          sourceType: errRec.sourceType,
          name: '',
          studentId: null,
          targetClass: cl,
          similarity: 0,
          matchStatus: 'Lỗi đọc tệp',
          matchReason: errRec.error,
          rawBytes: errRec.rawBytes || null,
          rawFile: errRec.rawFile || null,
          files: [],
          info: { evidence: ['Tệp bị lỗi hoặc có mật khẩu'], images: [] },
          scores: [0, 0, 0, 0, 0],
          approved: false,
          approvedAt: null,
          approvedScores: null,
          auditHistory: [],
          reviewed: [false, false, false, false, false],
          notes: `Lỗi: ${errRec.error}`,
          status: 'Lỗi',
          aiResult: null,
          aiError: errRec.error,
          tc4parts: [0, 0, 0, 0, 0],
          tc4exception: '',
        });
      }

      if (newRecords.length === 0) {
        throw new Error('Không phân tích được bài nộp nào từ danh sách đã chọn.');
      }

      setBatches(newRecords);
      setSelected(newRecords[0].id);
      setStagedItems([]);
      setTab('matching'); // Direct to Name Matching Verification tab
      setStatusMessage(
        `Đã phân tích xong ${newRecords.length} bài nộp. Vui lòng đối soát bảng ghép tên trước khi chấm.`
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading('');
    }
  }

  // Load comprehensive 9-scenario demo test suite (Section 10)
  async function loadDemoSamples() {
    setError('');
    setLoading('Đang nạp bộ dữ liệu DEMO kiểm thử toàn diện...');
    try {
      const res = await fetch('/api/demo-samples');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Lỗi nạp bài mẫu');

      const newRecords = [];
      const studentSubCount = {};

      for (const s of data.samples) {
        const mockFiles = (s.files || []).map((f) => ({
          name: f.name,
          path: f.path,
          textContent: f.textContent,
          data: f.textContent
            ? new TextEncoder().encode(f.textContent)
            : new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
        }));

        const info = classify(mockFiles);
        const matchResult = matchStudentAdvanced(s.label, mockFiles, ENRICHED_ROSTER, cl);

        let finalName = s.expectedStudent || matchResult.studentName || '';
        let finalId = null;
        if (finalName) {
          const found = currentClassStudents.find((x) => x.name === finalName);
          if (found) finalId = found.studentId;
        }

        let matchStatus = s.expectedStatus || matchResult.status;
        if (finalId) {
          studentSubCount[finalId] = (studentSubCount[finalId] || 0) + 1;
          if (studentSubCount[finalId] > 1 && s.expectedStatus === 'Trùng bài') {
            matchStatus = 'Trùng bài';
          }
        }

        newRecords.push({
          id: crypto.randomUUID(),
          label: s.label,
          sourceType: s.sourceType,
          name: finalName,
          studentId: finalId,
          targetClass: s.expectedClass || cl,
          similarity: s.similarity !== undefined ? s.similarity : matchResult.similarity,
          matchStatus,
          matchReason: s.note || s.errorDetail || matchResult.reason,
          suggestedStudent: s.suggestedStudent ? { name: s.suggestedStudent } : matchResult.suggestedStudent,
          wrongClassStudent: s.wrongClass ? { name: s.suggestedStudent, className: s.wrongClass } : matchResult.wrongClassStudent,
          files: mockFiles,
          info,
          scores: [0, 0, 0, 0, 0],
          approved: false,
          approvedAt: null,
          approvedScores: null,
          auditHistory: [],
          reviewed: [false, false, false, false, false],
          notes: s.errorDetail || '',
          status: s.expectedStatus === 'Lỗi đọc tệp' ? 'Lỗi' : 'Chưa chấm',
          aiResult: null,
          aiError: s.errorDetail || '',
          tc4parts: [0, 0, 0, 0, 0],
          tc4exception: '',
        });
      }

      setBatches(newRecords);
      setSelected(newRecords[0].id);
      setTab('matching');
      setStatusMessage(
        `Đã nạp đủ 9 tình huống DEMO theo Mục 10 (Folder, ZIP, RAR, Thư mục tổng, Trùng tên, Sai ký tự, Nộp nhầm lớp, Nộp 2 lần, RAR lỗi). Bạn có thể kiểm tra trực tiếp.`
      );
    } catch (e) {
      setError('Lỗi nạp bài mẫu: ' + e.message);
    } finally {
      setLoading('');
    }
  }

  // Teacher manually reassigns student in matching table
  function reassignStudent(batchId, studentId) {
    const st = currentClassStudents.find((s) => s.studentId === studentId);
    if (!studentId || !st) {
      update(batchId, {
        studentId: null,
        name: '',
        matchStatus: 'Không tìm thấy',
        matchReason: 'Giáo viên đã gỡ ghép học sinh.',
        approved: false,
      });
      return;
    }

    update(batchId, {
      studentId: st.studentId,
      name: st.name,
      matchStatus: 'Đã tự ghép',
      matchReason: `Giáo viên xác nhận ghép thủ công với [${st.studentId}] ${st.name}`,
      similarity: 100,
      approved: false,
    });
    setStatusMessage(`Đã gán bài nộp cho học sinh ${st.name} (${st.studentId}).`);
  }

  // Merge duplicate submissions
  function mergeSubmissions(sourceBatch, targetBatchId) {
    const target = batches.find((b) => b.id === targetBatchId);
    if (!target) return;

    const mergedFiles = [...target.files, ...sourceBatch.files];
    const newInfo = classify(mergedFiles);

    update(target.id, {
      files: mergedFiles,
      info: newInfo,
      matchReason: `Đã gộp ${sourceBatch.files.length} tệp từ "${sourceBatch.label}" vào bài này.`,
      matchStatus: 'Đã tự ghép',
    });

    // Remove source batch
    setBatches((prev) => prev.filter((b) => b.id !== sourceBatch.id));
    setStatusMessage(`Đã gộp thành công bài nộp vào học sinh ${target.name}.`);
  }

  // Retry extraction for a single failed RAR/ZIP batch
  async function retryExtractBatch(batchId) {
    const b = batches.find((x) => x.id === batchId);
    if (!b) return;

    setError('');
    setLoading(`Đang thử giải nén lại: ${b.label}...`);

    try {
      let u8 = b.rawBytes;
      if (!u8 && b.rawFile) {
        u8 = new Uint8Array(await b.rawFile.arrayBuffer());
      }

      // If bytes not found in memory, check if we can fetch from sample-rar-files
      if (!u8) {
        try {
          const res = await fetch('/api/sample-rar-files');
          const data = await res.json();
          const matchSample = (data.samples || []).find((s) => s.name === b.label);
          if (matchSample) {
            const raw = atob(matchSample.base64);
            u8 = new Uint8Array(raw.length);
            for (let i = 0; i < raw.length; i++) u8[i] = raw.charCodeAt(i);
          }
        } catch (_) {}
      }

      if (!u8) {
        throw new Error(
          'Không tìm thấy dữ liệu tệp trong bộ nhớ. Vui lòng bấm "Chọn tệp" để tải lại tệp RAR này.'
        );
      }

      const prefix = b.label.replace(/\.[^.]+$/, '') + '/';
      const entries = await extractRarViaServer(u8, prefix);

      if (!entries || entries.length === 0) {
        throw new Error('Tệp RAR rỗng hoặc không trích xuất được tệp nào.');
      }

      // Re-segment
      const segments = inferSegments(entries, b.label.replace(/\.[^.]+$/, ''));
      const seg = segments[0] || { label: b.label, files: entries };
      const info = classify(seg.files);

      // Re-run matching with current class roster
      const matchResult = matchStudentAdvanced(seg.label, seg.files, ENRICHED_ROSTER, cl);

      update(b.id, {
        files: seg.files,
        info,
        rawBytes: u8,
        matchStatus: matchResult.status,
        matchReason: `Giải nén lại thành công (${seg.files.length} tệp). ${matchResult.reason}`,
        name: matchResult.studentName || '',
        studentId: matchResult.studentId || null,
        targetClass: matchResult.targetClass || cl,
        similarity: matchResult.similarity || 0,
        suggestedStudent: matchResult.suggestedStudent || null,
        wrongClassStudent: matchResult.wrongClassStudent || null,
        candidates: matchResult.candidates || [],
        status: 'Chưa chấm',
        notes: '',
        aiError: '',
      });

      setStatusMessage(`Đã giải nén và ghép tên thành công bài ${b.label} (${seg.files.length} tệp)!`);
    } catch (err) {
      console.error('Lỗi khi thử giải nén lại:', err);
      update(b.id, {
        matchStatus: 'Lỗi đọc tệp',
        matchReason: `Cần kiểm tra: ${err.message}`,
        notes: `Cần kiểm tra: ${err.message}`,
        status: 'Lỗi',
      });
      setError(`Không thể giải nén bài ${b.label}: ${err.message}`);
    } finally {
      setLoading('');
    }
  }

  // Retry all failed batches
  async function retryAllFailedBatches() {
    const failedBatches = batches.filter(
      (b) => b.matchStatus === 'Lỗi đọc tệp' || (b.sourceType === 'RAR' && b.files.length === 0)
    );

    if (failedBatches.length === 0) {
      setStatusMessage('Không có bài nào bị lỗi cần giải nén lại.');
      return;
    }

    setLoading(`Đang thử lại ${failedBatches.length} bài lỗi...`);
    let successCount = 0;
    let failCount = 0;

    for (const b of failedBatches) {
      try {
        let u8 = b.rawBytes;
        if (!u8 && b.rawFile) {
          u8 = new Uint8Array(await b.rawFile.arrayBuffer());
        }

        if (!u8) {
          const res = await fetch('/api/sample-rar-files');
          const data = await res.json();
          const matchSample = (data.samples || []).find((s) => s.name === b.label);
          if (matchSample) {
            const raw = atob(matchSample.base64);
            u8 = new Uint8Array(raw.length);
            for (let i = 0; i < raw.length; i++) u8[i] = raw.charCodeAt(i);
          }
        }

        if (!u8) {
          failCount++;
          continue;
        }

        const prefix = b.label.replace(/\.[^.]+$/, '') + '/';
        const entries = await extractRarViaServer(u8, prefix);

        if (entries && entries.length > 0) {
          const segments = inferSegments(entries, b.label.replace(/\.[^.]+$/, ''));
          const seg = segments[0] || { label: b.label, files: entries };
          const info = classify(seg.files);
          const matchResult = matchStudentAdvanced(seg.label, seg.files, ENRICHED_ROSTER, cl);

          update(b.id, {
            files: seg.files,
            info,
            rawBytes: u8,
            matchStatus: matchResult.status,
            matchReason: `Giải nén lại thành công (${seg.files.length} tệp). ${matchResult.reason}`,
            name: matchResult.studentName || '',
            studentId: matchResult.studentId || null,
            targetClass: matchResult.targetClass || cl,
            similarity: matchResult.similarity || 0,
            suggestedStudent: matchResult.suggestedStudent || null,
            wrongClassStudent: matchResult.wrongClassStudent || null,
            candidates: matchResult.candidates || [],
            status: 'Chưa chấm',
            notes: '',
            aiError: '',
          });
          successCount++;
        } else {
          failCount++;
        }
      } catch (e) {
        failCount++;
      }
    }

    setLoading('');
    setStatusMessage(
      `Hoàn tất thử lại: ${successCount} bài giải nén thành công, ${failCount} bài cần kiểm tra trực tiếp.`
    );
  }

  // Load real RAR test files (Nguyễn Công Nhật Minh, Hồ Nhật Duy, Ngô Bảo Tín & RAR4/RAR5)
  async function loadRealRarTestFiles() {
    setError('');
    setLoading('Đang nạp và giải nén các tệp RAR thực tế (RAR4, RAR5, lớp 7A5)...');
    try {
      const res = await fetch('/api/sample-rar-files');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Lỗi tải tệp RAR mẫu');

      // Set class to 7A5 because Minh, Duy, Tin belong to 7A5
      setCl('7A5');

      const newRecords = [];

      for (const s of data.samples) {
        const raw = atob(s.base64);
        const u8 = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) u8[i] = raw.charCodeAt(i);

        let entries = [];
        let extractErr = null;

        try {
          entries = await extractRarViaServer(u8, s.name.replace(/\.[^.]+$/, '') + '/');
        } catch (e) {
          extractErr = e.message;
        }

        if (extractErr) {
          newRecords.push({
            id: crypto.randomUUID(),
            label: s.name,
            sourceType: 'RAR',
            name: '',
            studentId: null,
            targetClass: '7A5',
            similarity: 0,
            matchStatus: 'Lỗi đọc tệp',
            matchReason: extractErr,
            rawBytes: u8,
            files: [],
            info: { evidence: [extractErr], images: [] },
            scores: [0, 0, 0, 0, 0],
            approved: false,
            approvedAt: null,
            approvedScores: null,
            auditHistory: [],
            reviewed: [false, false, false, false, false],
            notes: `Cần kiểm tra: ${extractErr}`,
            status: 'Lỗi',
            aiResult: null,
            aiError: extractErr,
            tc4parts: [0, 0, 0, 0, 0],
            tc4exception: '',
          });
        } else {
          const segments = inferSegments(entries, s.name.replace(/\.[^.]+$/, ''));
          const seg = segments[0] || { label: s.name, files: entries };
          const info = classify(seg.files);
          const matchResult = matchStudentAdvanced(seg.label, seg.files, ENRICHED_ROSTER, '7A5');

          newRecords.push({
            id: crypto.randomUUID(),
            label: s.name,
            sourceType: 'RAR',
            name: matchResult.studentName || '',
            studentId: matchResult.studentId || null,
            targetClass: '7A5',
            similarity: matchResult.similarity || 0,
            matchStatus: matchResult.status,
            matchReason: matchResult.reason,
            suggestedStudent: matchResult.suggestedStudent || null,
            wrongClassStudent: matchResult.wrongClassStudent || null,
            candidates: matchResult.candidates || [],
            rawBytes: u8,
            files: seg.files,
            info,
            scores: [0, 0, 0, 0, 0],
            approved: false,
            approvedAt: null,
            approvedScores: null,
            auditHistory: [],
            reviewed: [false, false, false, false, false],
            notes: '',
            status: 'Chưa chấm',
            aiResult: null,
            aiError: '',
            tc4parts: [0, 0, 0, 0, 0],
            tc4exception: '',
          });
        }
      }

      setBatches(newRecords);
      if (newRecords.length > 0) setSelected(newRecords[0].id);
      setTab('matching');
      const okCount = newRecords.filter((b) => b.matchStatus !== 'Lỗi đọc tệp').length;
      const errCount = newRecords.length - okCount;
      setStatusMessage(
        `Đã nạp và giải nén các bài RAR: ${okCount} bài thành công (Minh, Duy, Tín, RAR4, RAR5), ${errCount} bài phát hiện lỗi/mật khẩu an toàn.`
      );
    } catch (e) {
      setError('Lỗi kiểm thử tệp RAR: ' + e.message);
    } finally {
      setLoading('');
    }
  }

  // Single Student AI Grading
  async function gradeSingleAI(b, notify = true) {
    if (b.approved) {
      setError(
        `Bài thi của ${b.name || b.label} đã được khóa điểm chính thức. Hãy bấm "Mở khóa để chỉnh sửa" trước nếu muốn chấm lại bằng AI.`
      );
      return;
    }

    if (!consentConfirmed) {
      setError(
        'Vui lòng tích chọn "Tôi đồng ý gửi dữ liệu bài nộp lên Gemini AI" trước khi chấm.'
      );
      return;
    }

    if (b.status === 'Đang chấm AI...') {
      return;
    }

    update(b.id, { status: 'Đang chấm AI...', aiError: '' });
    if (notify) setLoading(`Đang phân tích bài nộp của ${b.name || b.label} bằng Gemini AI...`);

    try {
      const answerDoc = b.files.find((f) => /\.(docx|txt)$/i.test(f.name));
      let answerText = '';
      if (answerDoc) {
        answerText = await extractTextFromFile(answerDoc);
      }

      const imagesMeta = [];
      const imageFiles = b.files.filter((f) =>
        /\.(png|jpg|jpeg|webp)$/i.test(f.name)
      );
      for (const img of imageFiles.slice(0, 2)) {
        if (img.data) {
          imagesMeta.push({
            name: img.name,
            path: img.path,
            mimeType: img.name.endsWith('.png') ? 'image/png' : 'image/jpeg',
            base64: uint8ToBase64(img.data),
          });
        } else {
          imagesMeta.push({ name: img.name, path: img.path });
        }
      }

      const payload = {
        studentName: b.name,
        studentId: b.studentId,
        label: b.label,
        className: cl,
        fileTree: b.files.map((f) => ({ name: f.name, path: f.path })),
        answerText,
        images: imagesMeta,
        consentConfirmed: true,
      };

      const res = await fetch('/api/grade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Lỗi khi gọi API chấm AI');
      }

      update(b.id, {
        aiResult: data,
        status: 'Chờ duyệt',
        aiError: '',
      });

      if (notify) {
        setStatusMessage(
          `Gemini AI đã phân tích xong bài của ${b.name || b.label}. Điểm đề xuất: ${data.total}/10. Hãy xem và duyệt điểm.`
        );
      }
    } catch (err) {
      update(b.id, {
        status: 'Lỗi',
        aiError: err.message,
      });
      if (notify) setError(`Lỗi chấm AI: ${err.message}`);
    } finally {
      if (notify) setLoading('');
    }
  }

  // Batch AI Grading with concurrency queue limit (2 workers)
  async function gradeBatchWithConcurrency() {
    if (!consentConfirmed) {
      setError(
        'Vui lòng tích chọn "Tôi đồng ý gửi dữ liệu bài nộp lên Gemini AI" trước khi chấm.'
      );
      return;
    }

    const unapproved = batches.filter(
      (b) => !b.approved && b.status !== 'Đang chấm AI...' && b.name
    );

    if (unapproved.length === 0) {
      setError('Không có bài nộp nào hợp lệ (đã ghép tên) để chấm, hoặc tất cả đã được duyệt.');
      return;
    }

    setBatchGrading(true);
    setBatchProgress({ current: 0, total: unapproved.length });
    setStatusMessage(`Đang bắt đầu chấm AI cho ${unapproved.length} bài nộp...`);

    let nextIdx = 0;
    const workerLimit = 2; // Concurrency limit

    async function worker() {
      while (nextIdx < unapproved.length) {
        const item = unapproved[nextIdx++];
        await gradeSingleAI(item, false);
        setBatchProgress((prev) => ({
          ...prev,
          current: Math.min(prev.total, prev.current + 1),
        }));
      }
    }

    const workers = Array.from(
      { length: Math.min(workerLimit, unapproved.length) },
      () => worker()
    );

    await Promise.all(workers);
    setBatchGrading(false);
    setStatusMessage(
      `Đã hoàn thành phân tích AI cho ${unapproved.length} bài. Giáo viên hãy kiểm tra và xác nhận điểm từng học sinh.`
    );
  }

  // Teacher applies AI proposed scores
  function applyAIScores(b) {
    if (b.approved) {
      setError('Bài đã được duyệt và khóa điểm. Không thể áp dụng điểm AI.');
      return;
    }
    if (!b.aiResult) return;
    const ai = b.aiResult;
    update(b.id, {
      scores: [...ai.scores],
      tc4parts: [...(ai.tc4parts || [0, 0, 0, 0, 0])],
      tc4exception: ai.tc4exception || '',
      reviewed: [true, true, true, true, true],
      notes: b.notes
        ? b.notes + '\n[Gợi ý AI]: ' + ai.generalNote
        : '[Gợi ý AI]: ' + ai.generalNote,
      approved: false,
      status: 'Chờ duyệt',
    });
    setStatusMessage(
      `Đã nạp điểm AI đề xuất (${ai.total}/10) vào bảng điểm của ${b.name || b.label}. Giáo viên có thể tùy chỉnh trước khi xác nhận.`
    );
  }

  function setScore(b, i, val) {
    if (b.approved) {
      setError('Bài thi đã khóa điểm. Vui lòng bấm "Mở khóa để chỉnh sửa" trước khi sửa.');
      return;
    }
    const arr = [...b.scores];
    arr[i] = cap(val, MAX[i]);
    const rv = [...b.reviewed];
    rv[i] = true;
    update(b.id, {
      scores: arr,
      reviewed: rv,
      approved: false,
      status: 'Chờ duyệt',
    });
  }

  function setParts(b, i, val) {
    if (b.approved) {
      setError('Bài thi đã khóa điểm. Vui lòng bấm "Mở khóa để chỉnh sửa" trước khi sửa.');
      return;
    }
    let arr = [...b.tc4parts];
    const mx = [1, 0.25, 0.25, 1, 0.5][i];
    arr[i] = cap(val, mx);
    let scores = [...b.scores];
    scores[3] = sum(arr);
    let rv = [...b.reviewed];
    rv[3] = true;
    update(b.id, {
      tc4parts: arr,
      tc4exception: '',
      scores,
      reviewed: rv,
      approved: false,
      status: 'Chờ duyệt',
    });
  }

  function setException(b, code) {
    if (b.approved) {
      setError('Bài thi đã khóa điểm. Vui lòng bấm "Mở khóa để chỉnh sửa" trước khi sửa.');
      return;
    }
    let scores = [...b.scores],
      rv = [...b.reviewed];
    scores[3] = code ? rubric.tc4Exceptions[code] : sum(b.tc4parts);
    rv[3] = true;
    update(b.id, {
      tc4exception: code,
      scores,
      reviewed: rv,
      approved: false,
      status: 'Chờ duyệt',
    });
  }

  async function openPreview(f) {
    setViewFile(f);
    setFileContent('');
    try {
      if (f.textContent) {
        setFileContent(f.textContent);
      } else if (/\.docx$/i.test(f.name)) {
        let r = await mammoth.extractRawText({
          arrayBuffer: f.data.buffer.slice(
            f.data.byteOffset,
            f.data.byteOffset + f.data.byteLength
          ),
        });
        setFileContent(r.value || 'Tệp Word không có văn bản đọc được');
      } else if (/\.txt$/i.test(f.name)) {
        setFileContent(new TextDecoder('utf-8').decode(f.data));
      } else if (/\.(png|jpg|jpeg|gif|webp|bmp)$/i.test(f.name)) {
        setFileContent(URL.createObjectURL(new Blob([f.data])));
      } else {
        setFileContent(
          'Đã nhận tệp. Hỗ trợ xem ảnh và đọc DOCX/TXT trực tiếp; định dạng khác có thể tải về để xem.'
        );
      }
    } catch (e) {
      setFileContent('Không đọc được tệp: ' + e.message);
    }
  }

  // Approve logic
  function approve(b) {
    if (!b) return;

    if (b.approved) {
      setError(`Bài thi của ${b.name} đã được khóa điểm chính thức. Không thể duyệt lần hai.`);
      return;
    }
    if (!b.name) {
      setError('Hãy gán đúng học sinh trước khi duyệt');
      return;
    }
    if (!b.reviewed || !b.reviewed.every(Boolean)) {
      setError('Phải kiểm tra và nhập đủ 5 tiêu chí trước khi duyệt');
      return;
    }

    const now = new Date().toISOString();
    const currentTotal = getTotal(b);
    const historyEntry = {
      timestamp: now,
      action: 'approved',
      scores: [...b.scores],
      total: currentTotal,
      note: b.notes || 'Giáo viên duyệt chính thức',
    };

    update(b.id, {
      approved: true,
      status: 'Đã duyệt',
      approvedAt: now,
      approvedScores: [...b.scores],
      auditHistory: [...(b.auditHistory || []), historyEntry],
    });

    setError('');
    setStatusMessage(
      `Đã duyệt chính thức ${b.name}: ${currentTotal.toLocaleString('vi-VN')}/10 điểm (${new Date(now).toLocaleTimeString('vi-VN')}). Điểm đã được khóa an toàn.`
    );
  }

  // Unlock feature
  function requestUnlock(b) {
    setUnlockingId(b.id);
    setUnlockReason('');
  }

  function cancelUnlock() {
    setUnlockingId(null);
    setUnlockReason('');
  }

  function confirmUnlock(b) {
    if (!unlockReason.trim()) {
      setError('Vui lòng nhập lý do mở khóa bài nộp.');
      return;
    }
    const now = new Date().toISOString();
    const historyEntry = {
      timestamp: now,
      action: 'unlocked',
      reason: unlockReason.trim(),
      previousScores: [...b.scores],
      previousTotal: getTotal(b),
      previousApprovedAt: b.approvedAt || null,
    };

    update(b.id, {
      approved: false,
      status: 'Chờ duyệt',
      auditHistory: [...(b.auditHistory || []), historyEntry],
    });

    setUnlockingId(null);
    setUnlockReason('');
    setError('');
    setStatusMessage(
      `Đã mở khóa bài thi của ${b.name}. Trạng thái chuyển về "Chờ duyệt" để giáo viên chỉnh sửa.`
    );
  }

  // Exports with official accented names
  function exportExcel() {
    let rows = batches
      .filter((b) => b.approved)
      .map((b) => ({
        Lop: cl,
        'Mã học sinh': b.studentId || '',
        'Họ và tên': b.name, // Official accented name
        TC1: b.scores[0],
        TC2: b.scores[1],
        TC3: b.scores[2],
        TC4: b.scores[3],
        TC5: b.scores[4],
        'Tổng điểm': getTotal(b),
        'Thời điểm duyệt': b.approvedAt
          ? new Date(b.approvedAt).toLocaleString('vi-VN')
          : '',
        'Ghi chú': b.notes,
      }));
    if (!rows.length) {
      setError('Chưa có bài được duyệt chính thức');
      return;
    }
    let ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [
      { wch: 8 },
      { wch: 14 },
      { wch: 30 },
      ...Array(6).fill({ wch: 11 }),
      { wch: 22 },
      { wch: 40 },
    ];
    let wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, cl);
    download(
      XLSX.write(wb, { bookType: 'xlsx', type: 'array' }),
      `Tong_hop_Tin7_${cl}.xlsx`
    );
  }

  async function exportPersonal(b) {
    let rows = initialRubric.criteria.map(
      (it, i) =>
        new TableRow({
          children: [
            new TableCell({
              children: [new Paragraph(`${it.id} – ${it.label}`)],
            }),
            new TableCell({
              children: [
                new Paragraph(
                  `${b.scores[i].toLocaleString('vi-VN')} / ${it.max.toLocaleString('vi-VN')}`
                ),
              ],
            }),
          ],
        })
    );
    let doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({
              text: 'TRƯỜNG TH, THCS VÀ THPT FPT',
              heading: HeadingLevel.HEADING_2,
              alignment: AlignmentType.CENTER,
            }),
            new Paragraph({
              text: 'PHIẾU ĐÁNH GIÁ CÁ NHÂN – TIN HỌC 7',
              heading: HeadingLevel.HEADING_1,
              alignment: AlignmentType.CENTER,
            }),
            new Paragraph(`Năm học: 2026–2027 | Kiểm tra giữa kỳ I`),
            new Paragraph(`Họ và tên học sinh: ${b.name} | Lớp: ${cl}`),
            new Paragraph(`Mã học sinh: ${b.studentId || 'N/A'}`),
            new Paragraph(`Bài nộp: ${b.label}`),
            b.approvedAt
              ? new Paragraph(
                  `Thời điểm phê duyệt: ${new Date(b.approvedAt).toLocaleString('vi-VN')}`
                )
              : new Paragraph(''),
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: [
                new TableRow({
                  children: [
                    new TableCell({ children: [new Paragraph('Tiêu chí')] }),
                    new TableCell({
                      children: [new Paragraph('Điểm GV duyệt')],
                    }),
                  ],
                }),
                ...rows,
              ],
            }),
            new Paragraph({
              text: `TỔNG ĐIỂM: ${getTotal(b).toLocaleString('vi-VN')} / 10`,
              heading: HeadingLevel.HEADING_2,
            }),
            new Paragraph(`Nhận xét: ${b.notes || 'Không có'}`),
            new Paragraph(
              'Giáo viên bộ môn: ................................................'
            ),
            new Paragraph(
              'Lưu ý: Phiếu cá nhân thiết kế trong ứng dụng; phiếu tổng hợp sử dụng mẫu trường gốc.'
            ),
          ],
        },
      ],
    });
    download(
      await Packer.toBlob(doc),
      `Phieu_ca_nhan_Tin7_${cl}_${key(b.name)}.docx`,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
  }

  async function exportZipPersonals() {
    let pass = batches.filter((b) => b.approved);
    if (!pass.length) {
      setError('Chưa có bài được duyệt chính thức');
      return;
    }
    const zip = new JSZip();
    for (const b of pass) {
      const rows = initialRubric.criteria.map(
        (it, i) =>
          new TableRow({
            children: [
              new TableCell({
                children: [new Paragraph(`${it.id}: ${it.label}`)],
              }),
              new TableCell({
                children: [new Paragraph(`${b.scores[i]}/${it.max}`)],
              }),
            ],
          })
      );
      let doc = new Document({
        sections: [
          {
            children: [
              new Paragraph({
                text: 'PHIẾU ĐÁNH GIÁ CÁ NHÂN – TIN HỌC 7',
                heading: HeadingLevel.HEADING_1,
              }),
              new Paragraph(`Họ và tên: ${b.name} | Lớp: ${cl}`),
              new Table({ rows }),
              new Paragraph(`TỔNG ĐIỂM: ${getTotal(b)}/10`),
              new Paragraph('Nhận xét: ' + (b.notes || 'Không có')),
            ],
          },
        ],
      });
      zip.file(`Phieu_${key(b.name)}.docx`, await Packer.toBlob(doc));
    }
    download(await zip.generateAsync({ type: 'blob' }), `Phieu_ca_nhan_${cl}.zip`);
  }

  async function exportOriginal() {
    setError('');
    try {
      const template = await fetch('/phieu_tong_hop_Tin7_goc.docx').then((r) =>
        r.arrayBuffer()
      );
      const zip = await JSZip.loadAsync(template);
      const xml = await zip.file('word/document.xml').async('string');
      const dom = new DOMParser().parseFromString(xml, 'application/xml');
      const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
      const tables = [...dom.getElementsByTagNameNS(ns, 'tbl')];
      let active = '',
        filled = 0;
      let gradeMap = new Map(
        batches.filter((b) => b.approved).map((b) => [key(b.name), b])
      );

      function cellText(cell) {
        return [...cell.getElementsByTagNameNS(ns, 't')]
          .map((x) => x.textContent)
          .join('');
      }

      function cells(row) {
        return [...row.children].filter((x) => x.localName === 'tc');
      }

      function writeCell(cell, value) {
        const paras = [...cell.getElementsByTagNameNS(ns, 'p')];
        const p = paras[0] || dom.createElementNS(ns, 'w:p');
        if (!paras.length) cell.append(p);
        let t = p.getElementsByTagNameNS(ns, 't')[0];
        if (!t) {
          const r = dom.createElementNS(ns, 'w:r');
          t = dom.createElementNS(ns, 'w:t');
          r.append(t);
          p.append(r);
        }
        t.textContent = String(value);
      }

      for (const t of tables) {
        const str = [...t.getElementsByTagNameNS(ns, 't')]
          .map((x) => x.textContent)
          .join(' ');
        const m = str.match(/Lớp\s*:\s*(7A\d+)/i);
        if (m) {
          active = m[1].toUpperCase();
          continue;
        }
        if (!active || active !== cl) continue;
        for (const row of [...t.children].filter((x) => x.localName === 'tr')) {
          const cs = cells(row);
          if (cs.length < 8) continue;
          const name = cellText(cs[1]);
          const b = gradeMap.get(key(name));
          if (!b) continue;
          for (let i = 0; i < 5; i++)
            writeCell(cs[i + 2], b.scores[i].toLocaleString('vi-VN'));
          writeCell(cs[7], getTotal(b).toLocaleString('vi-VN'));
          filled++;
        }
      }
      if (!filled)
        throw Error(
          'Không tìm thấy dòng học sinh đã duyệt trong mẫu tổng hợp gốc. Hãy đối chiếu họ tên.'
        );
      const output = new XMLSerializer().serializeToString(dom);
      zip.file('word/document.xml', output);
      download(
        await zip.generateAsync({ type: 'blob' }),
        `Phieu_tong_hop_GOC_${cl}.docx`
      );
      setStatusMessage(
        `Đã điền ${filled} dòng đã duyệt vào mẫu Word chính thức (các lớp khác vẫn có trong tệp gốc).`
      );
    } catch (e) {
      setError('Lỗi xuất mẫu gốc: ' + e.message);
    }
  }

  function exportReview() {
    const rows = batches.map((b) => ({
      label: b.label,
      studentId: b.studentId,
      name: b.name,
      class: cl,
      sourceType: b.sourceType,
      similarity: b.similarity,
      matchStatus: b.matchStatus,
      scores: b.scores,
      approved: b.approved,
      approvedAt: b.approvedAt,
      auditHistory: b.auditHistory,
      status: b.status,
      aiResult: b.aiResult,
      notes: b.notes,
      evidence: b.info.evidence,
    }));
    download(
      JSON.stringify(
        { version: 'Tin7-MVP-v4-Hybrid-Match', class: cl, records: rows },
        null,
        2
      ),
      `Luu_ket_qua_${cl}.json`,
      'application/json'
    );
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandicon">7</div>
          <div>
            <b>FPT Tin Grader</b>
            <small>TIN HỌC 7 · GKI 2026–2027</small>
          </div>
        </div>
        <div className="aside-title">QUẢN LÝ CHẤM BÀI</div>
        {[
          ['upload', Upload, '1. Tải bài nộp'],
          ['matching', UserCheck, '2. Ghép tên học sinh'],
          ['results', ClipboardCheck, '3. Chấm & Duyệt điểm'],
          ['exports', FileDown, '4. Xuất biểu mẫu'],
          ['config', Settings, 'Cấu hình Rubric'],
        ].map(([id, Icon, text]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={'nav ' + (tab === id ? 'active' : '')}
          >
            <Icon size={18} />
            {text}
          </button>
        ))}
        <div className="aside-bottom">
          <ShieldCheck size={18} />
          <span>
            Hỗ trợ Folder, ZIP, RAR
            <br />
            <small>Dò tên không dấu tự động</small>
          </span>
        </div>
      </aside>

      <main className="main">
        <header>
          <div>
            <div className="eyebrow">TRƯỜNG TH, THCS VÀ THPT FPT · ĐÀ NẴNG</div>
            <h1>
              {tab === 'upload'
                ? 'Tải bài nộp hàng loạt'
                : tab === 'matching'
                ? 'Đối soát & Kiểm tra ghép tên học sinh'
                : tab === 'results'
                ? 'Chấm và duyệt bài Tin học 7'
                : tab === 'exports'
                ? 'Xuất phiếu đánh giá'
                : 'Quản lý quy tắc chấm'}
            </h1>
            <p>Bộ đề: Tổ chức góc học tập số · Năm học 2026–2027</p>
          </div>
          <div className="classpicker">
            <label>LỚP ĐANG CHẤM</label>
            <select
              value={cl}
              onChange={(e) => {
                setCl(e.target.value);
                setBatches([]);
                setSelected(null);
                setStagedItems([]);
                setError('');
              }}
            >
              {Object.keys(roster)
                .sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)))
                .map((x) => (
                  <option key={x}>{x}</option>
                ))}
            </select>
          </div>
        </header>

        {/* Global Missing Rubric Cases Warning (Requirement 14) */}
        <div className="rubric-warning">
          <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            <strong>Cảnh báo Rubric (80 / 195 mã đã chốt):</strong> Dữ liệu rubric
            hiện mới có 80 mã tình huống được giáo viên chốt; 115 mã lịch sử còn
            thiếu mô tả chi tiết. Gemini AI chỉ hỗ trợ nhận diện bằng chứng theo 5
            tiêu chí chuẩn và không tự tạo mã mới hay tự nhận đã bao quát toàn bộ 195
            tình huống.
          </div>
        </div>

        {/* Teacher Consent Box for Gemini AI Processing (Requirement 15) */}
        <div className="consent-box">
          <input
            type="checkbox"
            id="ai-consent"
            checked={consentConfirmed}
            onChange={(e) => setConsentConfirmed(e.target.checked)}
          />
          <label htmlFor="ai-consent">
            <strong>Xác nhận bảo mật & sử dụng Gemini AI:</strong> Tôi đồng ý gửi
            thông tin bài nộp (cây thư mục, tệp văn bản bài làm và hình ảnh) lên
            Google Gemini API (xử lý server-side bảo mật) để phân tích bằng chứng
            chấm bài. Không tự động chốt điểm khi chưa có quyết định của giáo viên.
          </label>
        </div>

        {error && (
          <div className="error">
            <AlertTriangle size={18} />
            {error}
            <button onClick={() => setError('')}>×</button>
          </div>
        )}

        {statusMessage && (
          <div className="notice">
            <CheckCircle size={17} />
            {statusMessage}
            <button onClick={() => setStatusMessage('')}>×</button>
          </div>
        )}

        <section className="stats">
          <article>
            <span>Học sinh trong danh sách</span>
            <strong>{currentClassStudents.length}</strong>
            <small>{cl}</small>
          </article>
          <article>
            <span>Nhóm bài nộp</span>
            <strong>{batches.length}</strong>
            <small>Sẵn sàng chấm: {matchingStats.readyToGrade}</small>
          </article>
          <article>
            <span>Đã duyệt chính thức</span>
            <strong>{approved}</strong>
            <small>
              {waitingReview > 0
                ? `${waitingReview} bài chờ duyệt`
                : 'Đã hoàn tất duyệt'}
            </small>
          </article>
          <article>
            <span>Mã tình huống Rubric</span>
            <strong>
              80 <em>/ 195</em>
            </strong>
            <small>115 mã chưa nạp *</small>
          </article>
        </section>

        {/* TAB 1: UNIFIED UPLOAD ZONE (Mục 2) */}
        {tab === 'upload' && (
          <>
            <section className="panel">
              <div className="panelheading">
                <div>
                  <h2>TẢI BÀI NỘP HÀNG LOẠT – FOLDER / ZIP / RAR</h2>
                  <p>
                    Tải bài của cả lớp trong một đợt dưới dạng Thư mục hoặc Tệp
                    nén. Hỗ trợ giải nén đệ quy ZIP và RAR4/RAR5 an toàn.
                  </p>
                </div>
                <span className="pill">Folder + ZIP + RAR</span>
              </div>

              <div className="unified-upload-box">
                <FileArchive size={48} color="#2563eb" style={{ margin: '0 auto 12px' }} />
                <h3 style={{ fontSize: 17, color: '#1e3a8a', margin: '0 0 6px' }}>
                  Khu vực nạp bài nộp hỗn hợp cho lớp {cl}
                </h3>
                <p style={{ fontSize: 13, color: '#64748b', maxWidth: 620, margin: '0 auto 16px' }}>
                  Bạn có thể chọn thêm nhiều đợt thư mục hoặc tệp ZIP/RAR trước khi
                  bấm phân tích. Hệ thống tự động giải nén và giữ nguyên cấu trúc.
                </p>

                <div className="unified-upload-actions">
                  <button
                    className="btn-upload-choice"
                    onClick={() => folderInputRef.current.click()}
                  >
                    <FolderOpen size={20} />
                    <span>Chọn Thư mục (Folder)</span>
                  </button>

                  <button
                    className="btn-upload-choice"
                    onClick={() => fileInputRef.current.click()}
                  >
                    <FileArchive size={20} />
                    <span>Chọn tệp (ZIP / RAR)</span>
                  </button>
                </div>

                <input
                  hidden
                  ref={folderInputRef}
                  type="file"
                  multiple
                  webkitdirectory=""
                  directory=""
                  onChange={(e) => {
                    handleStageFolder(e.target.files);
                    e.target.value = '';
                  }}
                />
                <input
                  hidden
                  ref={fileInputRef}
                  type="file"
                  accept=".zip,.rar"
                  multiple
                  onChange={(e) => {
                    handleStageFiles(e.target.files);
                    e.target.value = '';
                  }}
                />

                {/* Staging List */}
                {stagedItems.length > 0 && (
                  <div className="staging-box">
                    <div className="staging-head">
                      <span>
                        Danh sách đang chờ phân tích ({stagedItems.length} nguồn bài)
                      </span>
                      <button
                        onClick={clearStagedItems}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: '#ef4444',
                          fontSize: 12,
                          cursor: 'pointer',
                          fontWeight: 700,
                        }}
                      >
                        Xóa tất cả
                      </button>
                    </div>

                    <div className="staging-chips">
                      {stagedItems.map((it) => (
                        <div key={it.id} className="staging-chip">
                          {it.type === 'Folder' ? (
                            <FolderOpen size={13} color="#2563eb" />
                          ) : (
                            <FileArchive size={13} color="#7c3aed" />
                          )}
                          <b>{it.name}</b>
                          <span>({it.filesCount ? `${it.filesCount} tệp` : it.size})</span>
                          <button
                            className="staging-chip-btn"
                            onClick={() => removeStagedItem(it.id)}
                            title="Xóa tệp này"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>

                    <div style={{ textAlign: 'center', marginTop: 18 }}>
                      <button
                        className="btn-process-files"
                        onClick={processStagedItems}
                        disabled={!!loading}
                      >
                        <UserCheck size={18} style={{ marginRight: 8, verticalAlign: -3 }} />
                        Phân tích và phân loại bài nộp
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Demo Mock Testing Button - Section 10 */}
              <div
                style={{
                  marginTop: 20,
                  padding: 16,
                  background: '#f0fdf4',
                  borderRadius: 10,
                  border: '1px solid #bbf7d0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 12,
                }}
              >
                <div>
                  <strong style={{ color: '#166534', display: 'block', fontSize: 13 }}>
                    Bộ dữ liệu DEMO kiểm thử toàn diện 9 tình huống (Mục 10)
                  </strong>
                  <span style={{ fontSize: 12, color: '#374151' }}>
                    Gồm: Folder không dấu, ZIP, RAR, Thư mục tổng 2 học sinh, Trùng tên, Sai 1 ký tự, Nộp nhầm lớp, Nộp 2 lần, và RAR lỗi/mật khẩu.
                  </span>
                </div>
                <button
                  onClick={loadDemoSamples}
                  className="btn-mock"
                  style={{
                    padding: '9px 16px',
                    borderRadius: 8,
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    cursor: 'pointer',
                  }}
                >
                  <Sparkles size={16} /> Nạp 9 ca kiểm thử DEMO
                </button>
              </div>

              {/* Real RAR test files button (Nguyễn Công Nhật Minh, Hồ Nhật Duy, Ngô Bảo Tín & RAR4/RAR5) */}
              <div
                style={{
                  marginTop: 12,
                  padding: 16,
                  background: '#f8fafc',
                  borderRadius: 10,
                  border: '1px solid #cbd5e1',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 12,
                }}
              >
                <div>
                  <strong style={{ color: '#0f172a', display: 'block', fontSize: 13 }}>
                    Kiểm thử giải nén tệp RAR thực tế (Nguyễn Công Nhật Minh, Hồ Nhật Duy, Ngô Bảo Tín & RAR4/RAR5)
                  </strong>
                  <span style={{ fontSize: 12, color: '#475569' }}>
                    Tự động nạp các tệp RAR thực tế lớp 7A5, kiểm tra giải nén WebAssembly qua /api/unrar và nhận diện tên học sinh.
                  </span>
                </div>
                <button
                  onClick={loadRealRarTestFiles}
                  className="smallbutton"
                  style={{
                    padding: '9px 16px',
                    borderRadius: 8,
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    cursor: 'pointer',
                    background: '#2563eb',
                    color: '#ffffff',
                    border: 'none',
                  }}
                >
                  <FileArchive size={16} /> Nạp & kiểm thử RAR thực tế
                </button>
              </div>

              {loading && <p className="loading">{loading}</p>}
            </section>
          </>
        )}

        {/* TAB 2: GIAO DIỆN KIỂM TRA GHÉP TÊN (Mục 4 & 5) */}
        {tab === 'matching' && (
          <section className="panel">
            <div className="panelheading">
              <div>
                <h2>BẢNG KIỂM TRA ĐỐI SOÁT GHÉP TÊN HỌC SINH</h2>
                <p>
                  Thuật toán chuẩn hóa tiếng Việt tự động nhận diện tên không dấu
                  với danh sách có dấu. Giáo viên có thể điều chỉnh toàn bộ trước
                  khi chấm.
                </p>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {batches.some((b) => b.matchStatus === 'Lỗi đọc tệp' || (b.sourceType === 'RAR' && b.files.length === 0)) && (
                  <button
                    onClick={retryAllFailedBatches}
                    className="smallbutton"
                    style={{
                      background: '#fef3c7',
                      color: '#92400e',
                      border: '1px solid #fde68a',
                      fontWeight: 700,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                    title="Thử giải nén lại tất cả bài bị lỗi"
                  >
                    <RotateCcw size={14} /> Thử lại tất cả bài lỗi
                  </button>
                )}
                <button
                  onClick={() => setTab('upload')}
                  className="smallbutton"
                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  <Upload size={14} /> Thêm bài nộp
                </button>
                <button
                  onClick={() => setTab('results')}
                  className="btn-process-files"
                  style={{ padding: '8px 18px', fontSize: 12 }}
                >
                  <Play size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
                  Chuyển sang Chấm bài & Duyệt điểm
                </button>
              </div>
            </div>

            {/* 6 Statistical Cards (Mục 5) */}
            <div className="matching-stats-grid">
              <div className="stat-card-match">
                <small>Tổng bài nộp</small>
                <strong>{matchingStats.total}</strong>
              </div>
              <div className="stat-card-match" style={{ borderLeft: '4px solid #16a34a' }}>
                <small style={{ color: '#16a34a' }}>Đã tự ghép</small>
                <strong style={{ color: '#16a34a' }}>{matchingStats.autoMatched}</strong>
              </div>
              <div className="stat-card-match" style={{ borderLeft: '4px solid #d97706' }}>
                <small style={{ color: '#d97706' }}>Cần xác nhận</small>
                <strong style={{ color: '#d97706' }}>{matchingStats.needsConfirm}</strong>
              </div>
              <div className="stat-card-match" style={{ borderLeft: '4px solid #dc2626' }}>
                <small style={{ color: '#dc2626' }}>Chưa xác định / Lỗi</small>
                <strong style={{ color: '#dc2626' }}>{matchingStats.notFound}</strong>
              </div>
              <div className="stat-card-match" style={{ borderLeft: '4px solid #9333ea' }}>
                <small style={{ color: '#9333ea' }}>Bài trùng</small>
                <strong style={{ color: '#9333ea' }}>{matchingStats.duplicate}</strong>
              </div>
              <div className="stat-card-match" style={{ borderLeft: '4px solid #2563eb' }}>
                <small style={{ color: '#2563eb' }}>Hợp lệ sẵn sàng chấm</small>
                <strong style={{ color: '#2563eb' }}>{matchingStats.readyToGrade}</strong>
              </div>
            </div>

            {/* Warning banner for failed batches */}
            {batches.some((b) => b.matchStatus === 'Lỗi đọc tệp') && (
              <div
                style={{
                  margin: '12px 0',
                  padding: '10px 14px',
                  background: '#fff1f2',
                  border: '1px solid #fecdd3',
                  borderRadius: 8,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: 12,
                  color: '#9f1239',
                  flexWrap: 'wrap',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <AlertTriangle size={16} />
                  <span>
                    Có <strong>{batches.filter((b) => b.matchStatus === 'Lỗi đọc tệp').length}</strong> bài nộp chưa giải nén được (tệp bị lỗi hoặc có mật khẩu). Theo quy định, hệ thống <strong>không chấm 0 điểm</strong>.
                  </span>
                </div>
                <button
                  onClick={retryAllFailedBatches}
                  className="smallbutton"
                  style={{
                    background: '#ffffff',
                    color: '#9f1239',
                    border: '1px solid #fecdd3',
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                  }}
                >
                  <RotateCcw size={13} /> Thử lại tất cả bài lỗi
                </button>
              </div>
            )}

            {/* Matching Table (8 Columns - Mục 5) */}
            <div className="matching-table-wrap">
              <table className="matching-table">
                <thead>
                  <tr>
                    <th style={{ width: 45 }}>STT</th>
                    <th>Tên thư mục hoặc file gốc</th>
                    <th style={{ width: 85 }}>Loại</th>
                    <th>Học sinh nhận diện</th>
                    <th style={{ width: 100 }}>Lớp</th>
                    <th>Mức độ khớp</th>
                    <th>Trạng thái</th>
                    <th style={{ textAlign: 'right' }}>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((b, idx) => {
                    const isDup = b.matchStatus === 'Trùng bài';
                    const isErr = b.matchStatus === 'Lỗi đọc tệp';
                    const isNeedsConfirm = b.matchStatus === 'Cần xác nhận';
                    const isAuto = b.matchStatus === 'Đã tự ghép';

                    return (
                      <tr key={b.id} style={{ background: isDup ? '#faf5ff' : isErr ? '#fff1f2' : 'inherit' }}>
                        <td><b>{idx + 1}</b></td>
                        <td>
                          <span style={{ fontWeight: 600, color: '#1e3a8a' }}>{b.label}</span>
                          <small style={{ display: 'block', color: '#64748b' }}>
                            {b.files.length} tệp tin
                          </small>
                        </td>
                        <td>
                          <span
                            className="pill"
                            style={{
                              background: b.sourceType === 'RAR' ? '#f3e8ff' : b.sourceType === 'ZIP' ? '#e0f2fe' : '#f1f5f9',
                              color: b.sourceType === 'RAR' ? '#6b21a8' : b.sourceType === 'ZIP' ? '#0369a1' : '#334155',
                              padding: '2px 8px',
                            }}
                          >
                            {b.sourceType}
                          </span>
                        </td>
                        <td>
                          {b.name ? (
                            <div>
                              <strong style={{ color: '#0f172a' }}>{b.name}</strong>
                              <small style={{ display: 'block', color: '#64748b' }}>
                                Mã: <code>{b.studentId || 'Chưa có mã'}</code>
                              </small>
                            </div>
                          ) : b.wrongClassStudent ? (
                            <span style={{ color: '#dc2626', fontWeight: 600 }}>
                              {b.wrongClassStudent.name} ({b.wrongClassStudent.className})
                            </span>
                          ) : (
                            <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>
                              Chưa xác định học sinh
                            </span>
                          )}
                        </td>
                        <td>
                          {b.wrongClassStudent ? (
                            <span style={{ color: '#b91c1c', fontWeight: 700 }}>
                              {b.wrongClassStudent.className} (Nhầm)
                            </span>
                          ) : (
                            <span>{cl}</span>
                          )}
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span
                              className={`sim-pill ${
                                b.similarity >= 95 ? 'sim-high' : b.similarity >= 80 ? 'sim-med' : 'sim-low'
                              }`}
                            >
                              {b.similarity}%
                            </span>
                            <small style={{ color: '#64748b', fontSize: 11 }}>
                              {b.matchReason}
                            </small>
                          </div>
                        </td>
                        <td>
                          {isAuto && (
                            <span className="badge-auto-matched">
                              <CheckCircle size={12} /> Đã tự ghép
                            </span>
                          )}
                          {isNeedsConfirm && (
                            <span className="badge-needs-confirm">
                              <AlertTriangle size={12} /> Cần xác nhận
                            </span>
                          )}
                          {isDup && (
                            <span className="badge-duplicate">
                              <Copy size={12} /> Trùng bài
                            </span>
                          )}
                          {isErr && (
                            <span className="badge-file-error">
                              <AlertTriangle size={12} /> Lỗi đọc tệp
                            </span>
                          )}
                          {b.matchStatus === 'Không tìm thấy' && (
                            <span className="badge-not-found">
                              <HelpCircle size={12} /> Không tìm thấy
                            </span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                            {/* Searchable Combobox for selecting student */}
                            <StudentCombobox
                              students={currentClassStudents}
                              value={b.studentId || ''}
                              onChange={(newId) => reassignStudent(b.id, newId)}
                              compact={true}
                              placeholder="🔍 Tìm & gán học sinh..."
                              assignedMap={assignedStudentMap}
                              currentBatchId={b.id}
                            />

                            {/* View Tree button */}
                            <button
                              className="smallbutton"
                              onClick={() => setTreeModalStudent(b)}
                              title="Xem cây thư mục bài nộp"
                            >
                              <Eye size={14} />
                            </button>

                            {/* Retry extraction button for failed items */}
                            {(isErr || (b.sourceType === 'RAR' && b.files.length === 0)) && (
                              <button
                                className="smallbutton"
                                style={{
                                  background: '#fef3c7',
                                  color: '#92400e',
                                  border: '1px solid #fde68a',
                                  fontWeight: 700,
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 4,
                                }}
                                onClick={() => retryExtractBatch(b.id)}
                                title="Thử giải nén lại tệp RAR này"
                              >
                                <RotateCcw size={13} /> Thử lại
                              </button>
                            )}

                            {/* Merge Duplicate option */}
                            {isDup && (
                              <button
                                className="smallbutton"
                                style={{ background: '#f3e8ff', color: '#6b21a8', border: '1px solid #d8b4fe' }}
                                onClick={() => {
                                  const other = batches.find(
                                    (x) => x.id !== b.id && x.studentId === b.studentId
                                  );
                                  if (other) mergeSubmissions(b, other.id);
                                }}
                                title="Gộp bài nộp này vào bài trước của học sinh"
                              >
                                <Layers size={14} /> Gộp bài
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {batches.length === 0 && (
              <div className="empty">
                Chưa có dữ liệu bài nộp. Vui lòng vào mục "1. Tải bài nộp" hoặc nạp bài mẫu DEMO.
              </div>
            )}
          </section>
        )}

        {/* TAB 3: RESULTS & GRADING (Mục 6, 7, 8) */}
        {tab === 'results' && (
          <section className="reviewlayout">
            <div className="panel leftpanel">
              <div className="panelheading">
                <h2>Danh sách bài ({batches.length})</h2>
                <span className="pill">{cl}</span>
              </div>

              {/* Batch AI Grading Bar */}
              {batches.length > 0 && (
                <div className="batch-box">
                  <div className="batch-box-row">
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#334155' }}>
                      Chấm AI hàng loạt cả lớp
                    </span>
                    <button
                      className="actions button btn-ai"
                      disabled={batchGrading || !consentConfirmed}
                      onClick={gradeBatchWithConcurrency}
                      style={{
                        padding: '6px 12px',
                        fontSize: 11,
                        borderRadius: 6,
                        cursor:
                          batchGrading || !consentConfirmed
                            ? 'not-allowed'
                            : 'pointer',
                      }}
                      title={
                        !consentConfirmed
                          ? 'Vui lòng tích chọn đồng ý sử dụng AI ở trên'
                          : 'Chấm tự động tuần tự với hàng đợi 2 bài cùng lúc'
                      }
                    >
                      <Bot size={14} />{' '}
                      {batchGrading ? 'Đang chấm...' : 'Chấm AI toàn bộ'}
                    </button>
                  </div>
                  {batchGrading && (
                    <>
                      <div className="progress-track">
                        <div
                          className="progress-fill"
                          style={{
                            width: `${
                              batchProgress.total
                                ? (batchProgress.current / batchProgress.total) *
                                  100
                                : 0
                            }%`,
                          }}
                        />
                      </div>
                      <small style={{ fontSize: 10, color: '#64748b' }}>
                        Đã chấm: {batchProgress.current} / {batchProgress.total} bài
                      </small>
                    </>
                  )}
                </div>
              )}

              <div className="studentlist">
                {batches.map((b) => {
                  const statusClass =
                    b.status === 'Đã duyệt'
                      ? 'status-approved'
                      : b.status === 'Đang chấm AI...'
                      ? 'status-grading'
                      : b.status === 'Chờ duyệt'
                      ? 'status-waiting'
                      : b.status === 'Lỗi'
                      ? 'status-error'
                      : 'status-idle';

                  return (
                    <button
                      onClick={() => {
                        setSelected(b.id);
                        setViewFile(null);
                        setUnlockingId(null);
                      }}
                      className={
                        'student ' + (selected === b.id ? 'chosen' : '')
                      }
                      key={b.id}
                    >
                      <div className="avatar">
                        {b.name ? b.name[0] : '?'}
                      </div>
                      <div>
                        <b>{b.name || b.label}</b>
                        <small>
                          {b.name ? b.label : 'Chưa ghép tên'} · {b.files.length}{' '}
                          tệp ({b.sourceType})
                        </small>
                      </div>
                      <span className={'status-badge ' + statusClass}>
                        {b.status}
                      </span>
                    </button>
                  );
                })}
              </div>
              {!batches.length && (
                <div className="empty">
                  Chưa có bài nộp. Vào mục Tải bài nộp hoặc nạp bài mẫu.
                </div>
              )}
            </div>

            <div className="panel detail">
              {current ? (
                <>
                  <div className="panelheading">
                    <div>
                      <h2>{current.name || 'Chưa ghép học sinh'}</h2>
                      <p>
                        {current.label} · Loại: <b>{current.sourceType}</b>
                        {current.studentId && ` · Mã HS: ${current.studentId}`}
                      </p>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span
                        className={
                          'status-badge ' +
                          (current.status === 'Đã duyệt'
                            ? 'status-approved'
                            : current.status === 'Đang chấm AI...'
                            ? 'status-grading'
                            : current.status === 'Chờ duyệt'
                            ? 'status-waiting'
                            : current.status === 'Lỗi'
                            ? 'status-error'
                            : 'status-idle')
                        }
                      >
                        {current.status}
                      </span>
                      {current.approved && (
                        <span
                          className="pill ok"
                          style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                        >
                          <Lock size={12} /> Đã khóa điểm
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Warning banner if current batch failed extraction */}
                  {(current.matchStatus === 'Lỗi đọc tệp' || (current.sourceType === 'RAR' && current.files.length === 0)) && (
                    <div
                      style={{
                        background: '#fff1f2',
                        border: '1px solid #fecdd3',
                        borderRadius: 8,
                        padding: '12px 16px',
                        marginBottom: 16,
                        color: '#9f1239',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <AlertTriangle size={18} />
                        <strong>Tệp bài nộp chưa được giải nén thành công</strong>
                      </div>
                      <p style={{ margin: '0 0 10px', fontSize: 12 }}>
                        {current.matchReason || 'Tệp bị lỗi cấu trúc nén hoặc có mật khẩu. Theo quy định khảo thí, không chấm 0 điểm mà yêu cầu kiểm tra lại.'}
                      </p>
                      <button
                        onClick={() => retryExtractBatch(current.id)}
                        className="btn-process-files"
                        style={{
                          background: '#e11d48',
                          borderColor: '#be123c',
                          padding: '6px 14px',
                          fontSize: 12,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                        }}
                      >
                        <RotateCcw size={14} /> Thử giải nén lại tệp này
                      </button>
                    </div>
                  )}

                  {/* AI Action Header for this student */}
                  <div
                    style={{
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      borderRadius: 8,
                      padding: '10px 14px',
                      marginBottom: 16,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: 8,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Bot size={17} color="#2563eb" />
                      <strong style={{ fontSize: 12, color: '#1e293b' }}>
                        Trợ lý khảo thí Gemini AI
                      </strong>
                    </div>

                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={() => gradeSingleAI(current)}
                        disabled={
                          current.status === 'Đang chấm AI...' ||
                          !consentConfirmed ||
                          current.approved
                        }
                        className="btn-ai"
                        style={{
                          padding: '7px 14px',
                          borderRadius: 6,
                          fontSize: 11,
                          fontWeight: 700,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          cursor:
                            current.status === 'Đang chấm AI...' ||
                            !consentConfirmed ||
                            current.approved
                              ? 'not-allowed'
                              : 'pointer',
                          opacity: current.approved ? 0.6 : 1,
                        }}
                        title={
                          current.approved
                            ? 'Bài đã khóa điểm. Vui lòng mở khóa để chấm lại.'
                            : ''
                        }
                      >
                        {current.status === 'Đang chấm AI...' ? (
                          <>
                            <RefreshCw size={14} className="spin" /> Đang chấm...
                          </>
                        ) : current.aiResult ? (
                          <>
                            <RefreshCw size={14} /> Chấm lại bằng AI
                          </>
                        ) : (
                          <>
                            <Bot size={14} /> Chấm bằng AI
                          </>
                        )}
                      </button>

                      {current.status === 'Lỗi' && (
                        <button
                          onClick={() => gradeSingleAI(current)}
                          style={{
                            padding: '7px 12px',
                            background: '#fee2e2',
                            color: '#b91c1c',
                            border: '1px solid #fca5a5',
                            borderRadius: 6,
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          Thử lại
                        </button>
                      )}
                    </div>
                  </div>

                  {current.aiError && (
                    <div
                      style={{
                        background: '#fee2e2',
                        color: '#991b1b',
                        padding: '10px 12px',
                        borderRadius: 6,
                        fontSize: 12,
                        marginBottom: 14,
                      }}
                    >
                      <AlertTriangle size={15} style={{ verticalAlign: -2 }} /> Lỗi
                      chấm AI: {current.aiError}
                    </div>
                  )}

                  {/* AI Results Display Card (Requirements 4, 9) */}
                  {current.aiResult && (
                    <div className="ai-card">
                      <div className="ai-card-header">
                        <div>
                          <strong
                            style={{
                              fontSize: 13,
                              color: '#1e3a8a',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                            }}
                          >
                            <Sparkles size={16} color="#2563eb" /> Kết quả thẩm định
                            từ Gemini AI (Đề xuất: {current.aiResult.total}/10)
                          </strong>
                          <small style={{ color: '#64748b' }}>
                            Mô hình: gemini-3.8-flash · Nhận diện theo bằng chứng kỹ
                            thuật
                          </small>
                        </div>
                        <button
                          onClick={() => applyAIScores(current)}
                          disabled={current.approved}
                          className="btn-apply-ai"
                          style={{
                            padding: '6px 14px',
                            borderRadius: 6,
                            fontSize: 11,
                            fontWeight: 700,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            cursor: current.approved ? 'not-allowed' : 'pointer',
                            opacity: current.approved ? 0.5 : 1,
                          }}
                          title={
                            current.approved
                              ? 'Bài thi đã khóa. Hãy mở khóa nếu muốn áp dụng lại điểm AI.'
                              : ''
                          }
                        >
                          <Check size={14} /> Áp dụng điểm AI vào bảng điểm
                        </button>
                      </div>

                      {/* Criteria breakdown */}
                      <div className="ai-item">
                        <div className="ai-item-head">
                          <span>TC1: Chuẩn bị cấu trúc thư mục</span>
                          <span>
                            {current.aiResult.scores[0]} / 1.0 đ{' '}
                            <span className="ai-code">
                              {current.aiResult.details?.tc1?.caseCode}
                            </span>
                          </span>
                        </div>
                        <div className="ai-evidence">
                          <strong>Bằng chứng:</strong>{' '}
                          {current.aiResult.details?.tc1?.evidence}
                        </div>
                        <div className="ai-reason">
                          <strong>Lý do:</strong>{' '}
                          {current.aiResult.details?.tc1?.reason}
                        </div>
                      </div>

                      <div className="ai-item">
                        <div className="ai-item-head">
                          <span>TC2: Tìm và lưu hình ảnh Đà Nẵng</span>
                          <span>
                            {current.aiResult.scores[1]} / 2.0 đ{' '}
                            <span className="ai-code">
                              {current.aiResult.details?.tc2?.caseCode}
                            </span>
                          </span>
                        </div>
                        <div className="ai-evidence">
                          <strong>Bằng chứng:</strong>{' '}
                          {current.aiResult.details?.tc2?.evidence}
                        </div>
                        <div className="ai-reason">
                          <strong>Lý do:</strong>{' '}
                          {current.aiResult.details?.tc2?.reason}
                        </div>
                      </div>

                      <div className="ai-item">
                        <div className="ai-item-head">
                          <span>TC3: Tạo tệp đáp án</span>
                          <span>
                            {current.aiResult.scores[2]} / 1.0 đ{' '}
                            <span className="ai-code">
                              {current.aiResult.details?.tc3?.caseCode}
                            </span>
                          </span>
                        </div>
                        <div className="ai-evidence">
                          <strong>Bằng chứng:</strong>{' '}
                          {current.aiResult.details?.tc3?.evidence}
                        </div>
                        <div className="ai-reason">
                          <strong>Lý do:</strong>{' '}
                          {current.aiResult.details?.tc3?.reason}
                        </div>
                      </div>

                      {/* FIXED TC4 C2-A display */}
                      <div className="ai-item">
                        <div className="ai-item-head">
                          <span>TC4: Trả lời câu hỏi kiến thức (5 ý chi tiết)</span>
                          <span>
                            {current.aiResult.scores[3]} / 3.0 đ{' '}
                            <span className="ai-code">
                              {current.aiResult.details?.tc4?.caseCode}
                            </span>
                          </span>
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            gap: 8,
                            flexWrap: 'wrap',
                            margin: '4px 0',
                            fontSize: 11,
                          }}
                        >
                          <span style={{ background: '#f1f5f9', padding: '2px 6px', borderRadius: 4 }}>
                            C1-A: {current.aiResult.tc4parts?.[0] || 0}/1.0
                          </span>
                          <span style={{ background: '#f1f5f9', padding: '2px 6px', borderRadius: 4 }}>
                            C1-B: {current.aiResult.tc4parts?.[1] || 0}/0.25
                          </span>
                          <span style={{ background: '#f1f5f9', padding: '2px 6px', borderRadius: 4 }}>
                            C1-C: {current.aiResult.tc4parts?.[2] || 0}/0.25
                          </span>
                          <span style={{ background: '#dcfce7', color: '#166534', padding: '2px 6px', borderRadius: 4, fontWeight: 700 }}>
                            C2-A (MP3): {current.aiResult.tc4parts?.[3] || 0}/1.0
                          </span>
                          <span style={{ background: '#f1f5f9', padding: '2px 6px', borderRadius: 4 }}>
                            C2-B: {current.aiResult.tc4parts?.[4] || 0}/0.5
                          </span>
                        </div>
                        <div className="ai-evidence">
                          <strong>Bằng chứng:</strong>{' '}
                          {current.aiResult.details?.tc4?.evidence}
                        </div>
                        <div className="ai-reason">
                          <strong>Lý do:</strong>{' '}
                          {current.aiResult.details?.tc4?.reason}
                        </div>
                      </div>

                      <div className="ai-item">
                        <div className="ai-item-head">
                          <span>TC5: Hoàn thiện sản phẩm</span>
                          <span>
                            {current.aiResult.scores[4]} / 3.0 đ{' '}
                            <span className="ai-code">
                              {current.aiResult.details?.tc5?.caseCode}
                            </span>
                          </span>
                        </div>
                        <div className="ai-evidence">
                          <strong>Bằng chứng:</strong>{' '}
                          {current.aiResult.details?.tc5?.evidence}
                        </div>
                        <div className="ai-reason">
                          <strong>Lý do:</strong>{' '}
                          {current.aiResult.details?.tc5?.reason}
                        </div>
                      </div>

                      <div
                        style={{
                          fontSize: 12,
                          color: '#334155',
                          marginTop: 8,
                          fontStyle: 'italic',
                        }}
                      >
                        <strong>Nhận xét tổng quan AI:</strong>{' '}
                        {current.aiResult.generalNote}
                      </div>
                    </div>
                  )}

                  <label className="fieldlabel">
                    Gán học sinh theo danh sách chính thức {cl}
                  </label>
                  {/* Searchable Combobox for selecting student in detail view */}
                  <StudentCombobox
                    students={currentClassStudents}
                    value={current.studentId || ''}
                    disabled={current.approved}
                    onChange={(newId) => reassignStudent(current.id, newId)}
                    compact={false}
                    placeholder="🔍 Tìm học sinh theo tên có dấu/không dấu, mã số hoặc STT..."
                    assignedMap={assignedStudentMap}
                    currentBatchId={current.id}
                  />

                  <div className="subgrid">
                    <div>
                      <h3>
                        <FolderOpen size={17} /> Cây tệp bài nộp ({current.files.length} tệp)
                      </h3>
                      <div className="filelist">
                        {current.files.map((f, i) => (
                          <button key={i} onClick={() => openPreview(f)}>
                            <FileText size={15} />
                            <span>{f.path}</span>
                            <Eye size={14} />
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h3>
                        <Search size={17} /> Minh chứng cấu trúc kỹ thuật
                      </h3>
                      {current.info.evidence.map((e, i) => (
                        <div className="evidence" key={i}>
                          {e}
                        </div>
                      ))}
                    </div>
                  </div>

                  {viewFile && (
                    <div className="preview">
                      <div className="panelheading">
                        <b>Xem nội dung: {viewFile.name}</b>
                        <button
                          className="smallbutton"
                          onClick={() => download(viewFile.data, viewFile.name)}
                        >
                          Tải tệp
                        </button>
                      </div>
                      {/\.(png|jpg|jpeg|gif|webp|bmp)$/i.test(viewFile.name) ? (
                        <img src={fileContent} alt={viewFile.name} />
                      ) : (
                        <pre>{fileContent}</pre>
                      )}
                    </div>
                  )}

                  <div className="divider" />

                  {/* Teacher Official Grading Section */}
                  <div className="panelheading">
                    <div>
                      <h2>Bảng điểm chính thức của giáo viên</h2>
                      <small style={{ color: current.approved ? '#059669' : '#64748b' }}>
                        {current.approved
                          ? `Đã khóa điểm lúc: ${new Date(current.approvedAt).toLocaleTimeString('vi-VN')} ngày ${new Date(current.approvedAt).toLocaleDateString('vi-VN')}`
                          : 'Điểm chỉ có giá trị pháp lý sau khi giáo viên bấm "Xác nhận điểm"'}
                      </small>
                    </div>
                    <strong className="total">
                      {getTotal(current).toLocaleString('vi-VN')} / 10
                    </strong>
                  </div>

                  {/* Read-only inputs for TC1–TC5 when approved */}
                  <div className="scoretable">
                    {rubric.criteria.map((c, i) => (
                      <div className="scorerow" key={c.id}>
                        <div>
                          <b>
                            {c.id}. {LABELS[i]}
                          </b>
                          <small>{current.info.evidence[i]}</small>
                        </div>
                        <div className="scorecontrol">
                          <input
                            type="number"
                            min="0"
                            max={MAX[i]}
                            step="0.25"
                            value={current.scores[i]}
                            disabled={current.approved}
                            onChange={(e) =>
                              setScore(current, i, e.target.value)
                            }
                            title={
                              current.approved
                                ? 'Bài đã khóa. Mở khóa để chỉnh sửa điểm.'
                                : ''
                            }
                          />
                          <span>/ {MAX[i].toLocaleString('vi-VN')}</span>
                          {current.reviewed[i] && (
                            <CheckCircle size={16} color="#15875b" />
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* TC4 5 Parts */}
                  <div className="tc4">
                    <h3>TC4 – Bảng chấm 5 ý chi tiết</h3>
                    <p>
                      Nhập theo cấu trúc 5 ý. C2-A nhận định MP3 là tệp âm thanh đạt
                      1,0 điểm.
                    </p>
                    <div className="parts">
                      {Object.entries(rubric.tc4Parts).map(([code, info], i) => (
                        <label key={code}>
                          <span>
                            {code}: {info.label} (/{info.max})
                          </span>
                          <select
                            value={current.tc4parts[i]}
                            onChange={(e) =>
                              setParts(current, i, e.target.value)
                            }
                            disabled={
                              current.approved || !!current.tc4exception
                            }
                          >
                            {Array.from(
                              { length: Math.round(info.max * 4) + 1 },
                              (_, k) => k * 0.25
                            ).map((v) => (
                              <option key={v} value={v}>
                                {v.toLocaleString('vi-VN')}
                              </option>
                            ))}
                          </select>
                        </label>
                      ))}
                    </div>

                    <label className="fieldlabel">
                      Ngoại lệ TC4 (nếu thực sự có bằng chứng)
                    </label>
                    <select
                      className="fullselect"
                      value={current.tc4exception}
                      disabled={current.approved}
                      onChange={(e) => setException(current, e.target.value)}
                    >
                      <option value="">Không dùng ngoại lệ</option>
                      {Object.entries(rubric.tc4Exceptions).map(([k, v]) => (
                        <option key={k} value={k}>
                          {k} – {v} điểm
                        </option>
                      ))}
                    </select>
                  </div>

                  <label className="fieldlabel">Nhận xét của giáo viên</label>
                  <textarea
                    rows={3}
                    value={current.notes}
                    disabled={current.approved}
                    onChange={(e) =>
                      update(current.id, {
                        notes: e.target.value,
                        approved: false,
                        status: 'Chờ duyệt',
                      })
                    }
                    placeholder={
                      current.approved
                        ? 'Bài đã khóa điểm chính thức. Hãy bấm "Mở khóa để chỉnh sửa" nếu muốn thay đổi nhận xét.'
                        : 'Nhận xét về sản phẩm, tệp thiếu, điểm cần lưu ý...'
                    }
                  />

                  {/* Unlock Confirmation Card */}
                  {unlockingId === current.id && (
                    <div className="unlock-box">
                      <h4>
                        <LockOpen size={16} /> Mở khóa để chỉnh sửa bài thi của{' '}
                        {current.name}
                      </h4>
                      <p
                        style={{
                          margin: '0 0 8px',
                          fontSize: 12,
                          color: '#78350f',
                        }}
                      >
                        Vui lòng ghi rõ lý do mở khóa (ví dụ: phúc khảo học sinh, sửa điểm TC4). Lịch sử điểm trước và sau sửa sẽ được lưu lại.
                      </p>
                      <textarea
                        rows={2}
                        value={unlockReason}
                        onChange={(e) => setUnlockReason(e.target.value)}
                        placeholder="Nhập lý do mở khóa điểm (bắt buộc)..."
                        autoFocus
                      />
                      <div className="unlock-actions">
                        <button
                          className="btn-unlock-cancel"
                          onClick={cancelUnlock}
                        >
                          Hủy bỏ
                        </button>
                        <button
                          className="btn-unlock-confirm"
                          disabled={!unlockReason.trim()}
                          onClick={() => confirmUnlock(current)}
                        >
                          Xác nhận mở khóa
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div
                    className="actions"
                    style={{
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      marginTop: 18,
                    }}
                  >
                    {!current.approved ? (
                      <button
                        className="primary"
                        onClick={() => approve(current)}
                      >
                        <CheckCircle size={18} /> Xác nhận điểm{' '}
                        {getTotal(current).toLocaleString('vi-VN')}/10
                      </button>
                    ) : (
                      <>
                        <button
                          className="primary"
                          disabled={true}
                          style={{
                            background: '#059669',
                            borderColor: '#059669',
                            color: '#fff',
                            opacity: 0.92,
                            cursor: 'not-allowed',
                          }}
                        >
                          <CheckCircle size={18} /> Đã xác nhận điểm (
                          {getTotal(current).toLocaleString('vi-VN')}/10)
                        </button>

                        <button
                          onClick={() => requestUnlock(current)}
                          style={{
                            border: '1.5px solid #d97706',
                            background: '#fffbeb',
                            color: '#b45309',
                            fontWeight: 700,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                          }}
                        >
                          <LockOpen size={16} /> Mở khóa để chỉnh sửa
                        </button>
                      </>
                    )}

                    <button
                      onClick={() => exportPersonal(current)}
                      disabled={!current.approved}
                    >
                      <FileDown size={17} /> Phiếu cá nhân
                    </button>
                  </div>

                  {/* Audit History Log */}
                  {current.auditHistory && current.auditHistory.length > 0 && (
                    <div className="audit-box">
                      <h4>
                        <Clock size={14} /> Lịch sử phê duyệt & điều chỉnh điểm (
                        {current.auditHistory.length} lần)
                      </h4>
                      {current.auditHistory.map((item, idx) => (
                        <div key={idx} className="audit-item">
                          <span
                            className={`audit-badge ${
                              item.action === 'approved'
                                ? 'audit-approved'
                                : 'audit-unlocked'
                            }`}
                          >
                            {item.action === 'approved' ? 'ĐÃ DUYỆT' : 'MỞ KHÓA'}
                          </span>
                          <strong>
                            {new Date(item.timestamp).toLocaleTimeString(
                              'vi-VN'
                            )}{' '}
                            {new Date(item.timestamp).toLocaleDateString(
                              'vi-VN'
                            )}
                          </strong>
                          :{' '}
                          {item.action === 'approved' ? (
                            <span>
                              Chốt điểm{' '}
                              <b>
                                {item.total?.toLocaleString('vi-VN')}/10
                              </b>{' '}
                              (Chi tiết: [{item.scores?.join(', ')}]).
                            </span>
                          ) : (
                            <span>
                              Mở khóa chỉnh sửa. Lý do: <em>"{item.reason}"</em> (Điểm
                              trước đó: {item.previousTotal}/10).
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="empty">
                  Chọn một học sinh bên trái để xem và duyệt bài.
                </div>
              )}
            </div>
          </section>
        )}

        {/* TAB 4: EXPORTS */}
        {tab === 'exports' && (
          <section className="panel exportpanel">
            <h2>Xuất kết quả {cl}</h2>
            <p>
              Chỉ các bài có điểm đã được giáo viên duyệt chính thức mới được đưa
              vào biểu mẫu. Sử dụng họ tên học sinh chính thức có dấu từ danh sách lớp.
            </p>
            <div className="exportgrid">
              <button onClick={exportOriginal}>
                <FileText size={30} />
                <b>Phiếu tổng hợp Word gốc</b>
                <span>
                  Điền điểm vào phiếu chính thức đã gửi, giữ nguyên bố cục DOCX
                </span>
              </button>
              <button onClick={exportExcel}>
                <FileDown size={30} />
                <b>Bảng điểm Excel</b>
                <span>Gồm mã HS, 5 tiêu chí, tổng điểm, họ tên có dấu và thời điểm duyệt</span>
              </button>
              <button onClick={exportZipPersonals}>
                <FileArchive size={30} />
                <b>ZIP phiếu cá nhân</b>
                <span>Xuất phiếu DOCX từng học sinh đã duyệt</span>
              </button>
              <button onClick={exportReview}>
                <Save size={30} />
                <b>Lưu kết quả JSON</b>
                <span>
                  Sao lưu kết quả điểm, bằng chứng và đánh giá AI
                </span>
              </button>
            </div>
          </section>
        )}

        {/* TAB 5: RUBRIC CONFIG */}
        {tab === 'config' && (
          <section className="panel">
            <h2>Quản lý quy tắc chấm & Rubric</h2>
            <p>
              Rubric được lưu dưới dạng JSON để quản lý mã tình huống và các quyết
              định của giáo viên.
            </p>
            <div className="info">
              <strong>Phiên bản: {rubric.version}</strong>
              <p>{rubric.note}</p>
              <p>
                TC4 gồm 5 ý: C1-A (1đ), C1-B (0.25đ), C1-C (0.25đ), C2-A (1đ - MP3 là tệp âm thanh), C2-B
                (0.5đ); các mã ngoại lệ có điểm riêng.
              </p>
              <p>
                Đã chốt trong lịch sử: {rubric.teacherApprovedHistoricalCodeCount} mã
                trên 195 mã.
              </p>
            </div>
            <div className="actions">
              <button onClick={() => rubricRef.current.click()}>
                <Upload size={17} /> Nhập rubric JSON đầy đủ
              </button>
              <button
                onClick={() =>
                  download(
                    JSON.stringify(rubric, null, 2),
                    'rubric_tin7.json',
                    'application/json'
                  )
                }
              >
                <Download size={17} /> Tải rubric hiện tại
              </button>
            </div>
            <input
              hidden
              type="file"
              accept=".json"
              ref={rubricRef}
              onChange={(e) => {
                if (e.target.files[0]) importRubric(e.target.files[0]);
                e.target.value = '';
              }}
            />
            <h3>Thang điểm 5 tiêu chí</h3>
            <div className="scoretable">
              {rubric.criteria.map((c) => (
                <div key={c.id} className="scorerow">
                  <b>
                    {c.id} – {c.label}
                  </b>
                  <strong>{c.max.toLocaleString('vi-VN')} điểm</strong>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Tree View Modal */}
        {treeModalStudent && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 999,
              padding: 20,
            }}
          >
            <div
              style={{
                background: 'white',
                borderRadius: 12,
                width: '100%',
                maxWidth: 650,
                maxHeight: '80vh',
                display: 'flex',
                flexDirection: 'column',
                padding: 20,
                boxShadow: '0 10px 25px rgba(0,0,0,0.2)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 14,
                  borderBottom: '1px solid #e2e8f0',
                  paddingBottom: 10,
                }}
              >
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, color: '#1e3a8a' }}>
                    Cây tệp: {treeModalStudent.label}
                  </h3>
                  <small style={{ color: '#64748b' }}>
                    Học sinh: {treeModalStudent.name || 'Chưa xác định'} ({treeModalStudent.sourceType})
                  </small>
                </div>
                <button
                  onClick={() => setTreeModalStudent(null)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    fontSize: 20,
                    cursor: 'pointer',
                    color: '#64748b',
                  }}
                >
                  <X size={20} />
                </button>
              </div>

              <div style={{ flex: 1, overflowY: 'auto', fontSize: 12 }}>
                <div className="filelist">
                  {treeModalStudent.files.map((f, i) => (
                    <div
                      key={i}
                      style={{
                        padding: '8px 10px',
                        borderBottom: '1px solid #f1f5f9',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                      }}
                    >
                      <FileText size={15} color="#2563eb" />
                      <span style={{ flex: 1, wordBreak: 'break-all' }}>{f.path}</span>
                    </div>
                  ))}
                  {treeModalStudent.files.length === 0 && (
                    <div style={{ padding: 20, color: '#94a3b8', textAlign: 'center' }}>
                      Không có tệp tin nào trong nhóm này (hoặc tệp RAR bị khóa mật khẩu).
                    </div>
                  )}
                </div>
              </div>

              <div style={{ textAlign: 'right', marginTop: 14 }}>
                <button
                  className="smallbutton"
                  onClick={() => setTreeModalStudent(null)}
                >
                  Đóng
                </button>
              </div>
            </div>
          </div>
        )}

        <footer>
          * FPT Tin Grader 7 tích hợp giải nén Folder/ZIP/RAR và thuật toán chuẩn hóa
          tiếng Việt tự động dò tên học sinh. Quyết định điểm chính thức thuộc thẩm
          quyền của giáo viên.
        </footer>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
