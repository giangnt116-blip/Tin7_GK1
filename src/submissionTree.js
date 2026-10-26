/**
 * SubmissionFileTree Standard Model & Normalizer
 * Standardizes files from Folder, ZIP, and RAR uploads into a uniform hierarchy.
 */

export function buildSubmissionFileTreeItem({
  submissionId,
  inputType,
  originalContainerName,
  originalRelativePath,
  submissionRelativePath,
  fileName,
  fileSize = 0,
  fileBytes = null,
  textContent = null,
  extractionStatus = 'success',
  verifiedEmptyDirectories = false,
  metadataLimitations = '',
}) {
  const normOriginal = originalRelativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const normSubmission = submissionRelativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = normSubmission.split('/').filter(Boolean);
  const parentDirectory = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
  const nestedDirectories = parts.length > 1 ? parts.slice(0, -1) : [];
  const ext = fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : '';

  return {
    submissionId,
    inputType, // 'Folder' | 'ZIP' | 'RAR'
    originalContainerName,
    originalRelativePath: normOriginal,
    submissionRelativePath: normSubmission,
    fileName,
    fileType: ext,
    fileSize,
    fileBytes,
    textContent,
    parentDirectory,
    nestedDirectories,
    extractionStatus,
    verifiedEmptyDirectories,
    metadataLimitations:
      metadataLimitations ||
      (inputType === 'Folder'
        ? 'Không xác minh được thư mục rỗng (hạn chế từ File System API trình duyệt)'
        : 'Cấu trúc nén đã đối soát'),
  };
}

/**
 * Normalizes a list of raw entries into structured student submissions with SubmissionFileTree
 */
export function normalizeEntriesToSubmissionTrees(entries, inputType, containerName) {
  // 1. Group entries by student root
  const rawGroups = {};

  for (const entry of entries) {
    const rawPath = (entry.path || entry.name || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const parts = rawPath.split('/').filter(Boolean);
    if (parts.length === 0) continue;

    let studentFolder = '';
    let subRelativePath = '';

    // If there is an outer batch container (e.g., 'TongHop_7A1', 'BaiKiemTra', or teacher container)
    // Check if parts[0] is container name or student folder
    const isEnclosingContainer =
      parts.length > 1 &&
      /^(bainop|tonghop|lop7|7a\d+|baitap|bathi|folder_nop_bai|submissions)/i.test(parts[0]);

    if (isEnclosingContainer && parts.length > 2) {
      studentFolder = parts[1];
      subRelativePath = parts.slice(2).join('/');
    } else if (parts.length > 1) {
      // Check if parts[0] is student folder (e.g. 'GK1_TIN7_NGOMINHNHAT')
      // If parts[0] has '01_' or '02_' or is a student label
      if (/^(01_|02_|01-|02-)/i.test(parts[0])) {
        studentFolder = containerName.replace(/\.(zip|rar)$/i, '');
        subRelativePath = parts.join('/');
      } else {
        studentFolder = parts[0];
        subRelativePath = parts.slice(1).join('/');
      }
    } else {
      // Single file at root
      studentFolder = containerName.replace(/\.(zip|rar)$/i, '');
      subRelativePath = parts[0];
    }

    if (!rawGroups[studentFolder]) {
      rawGroups[studentFolder] = [];
    }

    rawGroups[studentFolder].push({
      entry,
      rawPath,
      subRelativePath,
    });
  }

  // 2. Build SubmissionFileTree for each group
  const submissionBatches = [];

  for (const [studentLabel, groupEntries] of Object.entries(rawGroups)) {
    const submissionId = crypto.randomUUID();
    const treeItems = groupEntries.map(({ entry, rawPath, subRelativePath }) => {
      return buildSubmissionFileTreeItem({
        submissionId,
        inputType,
        originalContainerName: containerName,
        originalRelativePath: rawPath,
        submissionRelativePath: subRelativePath,
        fileName: entry.name || subRelativePath.split('/').pop(),
        fileSize: entry.data?.byteLength || entry.size || 0,
        fileBytes: entry.data || null,
        textContent: entry.textContent || null,
        extractionStatus: entry.error ? 'corrupted' : 'success',
        verifiedEmptyDirectories: inputType !== 'Folder',
        metadataLimitations:
          inputType === 'Folder' ? 'Không xác minh được thư mục rỗng' : '',
      });
    });

    submissionBatches.push({
      submissionId,
      studentLabel,
      inputType,
      containerName,
      fileTree: treeItems,
    });
  }

  return submissionBatches;
}
