export const MAX=[1,2,1,3,3];
export const cap=(x,m)=>Math.max(0,Math.min(m,Math.round((Number(x)||0)*4)/4));
export const sum=a=>Math.round(a.reduce((s,x)=>s+Number(x||0),0)*100)/100;
export const fold=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D').toLowerCase();
export const key=s=>fold(s).replace(/[^a-z0-9]/g,'');
export function classify(files){
 const paths=files.map(f=>fold(f.path||f.name).replace(/\\/g,'/'));
 const images=files.filter(f=>/\.(png|jpg|jpeg|gif|webp|bmp)$/i.test(f.name));
 const docs=files.filter(f=>/\.(docx|doc|txt|pdf)$/i.test(f.name));
 const answer=docs.find(f=>/dap[_ -]?an/i.test(fold(f.name)))||docs[0];
 const dir1=paths.some(p=>p.includes('01_'));
 const dir2=paths.some(p=>p.includes('02_'));
 const imageIn02=images.filter(f=>fold(f.path||'').includes('02_'));
 const hasDANANG=images.some(f=>key(f.name).includes('danang'));
 const evidence=[
   `${dir1?'Có':'Chưa nhận diện'} thư mục 01; ${dir2?'có':'chưa nhận diện'} thư mục 02`,
   `${images.length} ảnh; ${imageIn02.length} ảnh trong thư mục 02; ${hasDANANG?'có':'chưa thấy'} tên Da_Nang`,
   answer?`Tìm thấy tệp trả lời: ${answer.path||answer.name}`:'Chưa tìm thấy tệp trả lời',
   'TC4: phải đọc nội dung đáp án và đối chiếu 5 ý kiến thức (AI hoặc GV)',
   `Tổng ${files.length} tệp; ${images.length} ảnh; ${docs.length} tệp văn bản`
 ];
 // Đây chỉ là trạng thái kỹ thuật, KHÔNG kết luận điểm khi chưa đối chiếu rubric.
 return {evidence,files,answer,images,flags:[dir1,dir2,imageIn02.length>0,hasDANANG]};
}
export function matchStudent(label,roster){
 const q=key(label.replace(/^(gk1|tin7|lop7|7a\d+)[_\s-]*/ig,''));
 if(!q)return null;
 const matches=roster.filter(name=>q.includes(key(name))||key(name).includes(q));
 return matches.length===1?matches[0]:null;
}
export function validatedScores(scores){return MAX.map((m,i)=>cap(scores?.[i],m));}
