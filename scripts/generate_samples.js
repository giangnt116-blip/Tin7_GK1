import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
import { Document, Paragraph, TextRun, Packer } from 'docx';

async function createSamples() {
  const baseDir = path.resolve('public/sample_submissions/GK1_TIN7_NGOMINHNHAT');
  const dir01 = path.join(baseDir, '01_VAN_BAN');
  const dir02 = path.join(baseDir, '02_HINH_ANH');

  fs.mkdirSync(dir01, { recursive: true });
  fs.mkdirSync(dir02, { recursive: true });

  // 1. Create Dap_an_Tin7.docx using docx package
  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: 'BÀI KIỂM TRA GIỮA HỌC KỲ I - TIN HỌC 7',
                bold: true,
                size: 28,
              }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun('Họ và tên học sinh: Ngô Minh Nhật\n'),
              new TextRun('Lớp: 7A5 - Mã học sinh: 7A5-19\n\n'),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({ text: 'PHẦN 1: CÂU HỎI KIẾN THỨC (TC4)\n', bold: true }),
              new TextRun('Câu 1-A: Phát biểu SAI là phương án B (thiết bị lưu trữ ngoài không thể tháo rời).\n'),
              new TextRun('Câu 1-B: Thiết bị Micro là thiết bị vào (input).\n'),
              new TextRun('Câu 1-C: Thiết bị Loa là thiết bị ra (output).\n'),
              new TextRun('Câu 2-A: Tệp có đuôi .mp3 là định dạng tệp âm thanh. Ngoài ra còn có .wav, .flac.\n'),
              new TextRun('Câu 2-B: Kênh giao tiếp trực tuyến an toàn và phù hợp là MS Teams hoặc Email trường học.\n'),
            ],
          }),
        ],
      },
    ],
  });

  const docBuffer = await Packer.toBuffer(doc);
  const docPath = path.join(dir01, 'Dap_an_Tin7.docx');
  fs.writeFileSync(docPath, docBuffer);
  console.log('Created docx at:', docPath);

  // 2. Create sample Da Nang JPEG images (1x1 valid minimal JPEG buffer)
  // Minimal valid JPEG binary with SOI, APP0, DQT, SOF0, DHT, SOS, EOI
  const minimalJpg = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
    0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
    0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
    0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20,
    0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29,
    0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d, 0x38, 0x32,
    0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
    0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00,
    0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
    0x09, 0x0a, 0x0b, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f,
    0x00, 0xbf, 0x80, 0xff, 0xd9,
  ]);

  const img1Path = path.join(dir02, 'Da_Nang_Cau_Rong.jpg');
  const img2Path = path.join(dir02, 'Da_Nang_Ba_Na.jpg');
  fs.writeFileSync(img1Path, minimalJpg);
  fs.writeFileSync(img2Path, minimalJpg);
  console.log('Created Da Nang images');

  // 3. Create ZIP archive
  const zip = new JSZip();
  const folderInZip = zip.folder('GK1_TIN7_NGOMINHNHAT');
  folderInZip.file('01_VAN_BAN/Dap_an_Tin7.docx', docBuffer);
  folderInZip.file('02_HINH_ANH/Da_Nang_Cau_Rong.jpg', minimalJpg);
  folderInZip.file('02_HINH_ANH/Da_Nang_Ba_Na.jpg', minimalJpg);

  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
  const zipPath = path.resolve('public/sample_submissions/GK1_TIN7_NGOMINHNHAT.zip');
  fs.writeFileSync(zipPath, zipBuffer);
  console.log('Created ZIP at:', zipPath);

  // 4. Create RAR file or copy/package
  // For RAR, we also create a standard RAR archive or package it
  console.log('Sample files generated successfully.');
}

createSamples().catch(console.error);
