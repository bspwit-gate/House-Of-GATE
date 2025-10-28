/***** ================== CONFIG ================== *****/
const SHEET = {
  USERS: 'Users',
  SUBJECTS: 'Subjects',
  ATTEND: 'Attendance',
  LESSON: 'LessonLogs',
  HOMEWORK: 'Homework',
  EXAMS: 'Exams',
  ISSUES: 'Issues',
  REPORTS: 'Reports', // ใช้หรือไม่ใช้ก็ได้
  // --- ✅ NEW SHEETS ---
  GOODDEEDS: 'GoodDeeds', // บันทึกเด็กดี
  CALENDAR: 'Calendar', // ปฏิทินกิจกรรม
  NEWS: 'News', // แจ้งข่าวสาร
};
const WEEKS_PER_TERM = 20; // ใช้คำนวณ 80% (หน่วยกิต/สัปดาห์ * 20)

// หัวตารางมาตรฐานของแต่ละชีต (ใช้สร้างอัตโนมัติถ้าไม่เจอ)
const SHEET_HEADERS = {
  [SHEET.USERS]:     ['UserID','Password','FullName','Class','Role','Active','ProfileURL'],
  [SHEET.SUBJECTS]:  ['SubjectID','SubjectName','CreditPerWeek','TeacherID','TeacherName','Class','ClassLevel','Active'],
  [SHEET.ATTEND]:    ['Timestamp','Date','SubjectID','SubjectName','Class','StudentID','Status','Note','RecorderID'],
  [SHEET.LESSON]:    ['Timestamp','Date','SubjectID','SubjectName','Class','Topic','Summary','MaterialLink','TeacherID','TeacherName'],
  [SHEET.HOMEWORK]:  ['Timestamp','AssignDate','SubjectID','SubjectName','Class','Title','Detail','DueDate','AttachmentLink','AssignedBy'],
  [SHEET.EXAMS]:     ['Timestamp','ExamDate','ExamTime','SubjectID','SubjectName','Class','Scope','Location','Seat','Note','AssignedBy'],
  [SHEET.ISSUES]:    ['Timestamp','IssueID','CreatedBy','Role','Class','Category','Title','Detail','AttachmentLink','Status','Assignee','UpdatedAt','ResolutionNote'],
  [SHEET.REPORTS]:   ['Timestamp','Class','PayloadJSON'], // เผื่อเก็บ snapshot รายงาน
  // --- ✅ NEW HEADERS ---
  [SHEET.GOODDEEDS]: ['Timestamp','Date','StudentID','FullName','Class','RecordedByRole','RecordedByID','SubjectID','SubjectName','DeedTopic','DeedDetail'],
  [SHEET.CALENDAR]:  ['Timestamp','Date','Title','Detail','Link','AssignedBy','ClassLevel'],
  [SHEET.NEWS]:      ['Timestamp','Date','Title','Detail','Link','PostedBy'],
};
/***** ================== ENTRYPOINT ================== *****/
// ทดสอบเร็ว ๆ จากเบราว์เซอร์: เปิด Web App ด้วย GET จะได้หน้า ping
function doGet(e) {
  return HtmlService.createHtmlOutput('LMS GAS API is running ✅');
}

// Frontend เรียกด้วย fetch(POST) โดยส่ง JSON: { action: '...', payload: {...} }
function doPost(e) {
  try {
    const body = e && e.postData && e.postData.contents ?
JSON.parse(e.postData.contents) : {};
    const action = body.action;
    const payload = body.payload || {};
const router = {
      // auth
      loginUser,

      // users
      getUsers,
      upsertUser,
      deleteUser,
      getClassTeacher, // ✅ NEW: Contact Teacher

      // subjects
      getSubjectsByClass,
      getSubjectsForTeacher,

      // attendance
      saveAttendanceBulk,
      markAbsent,
      getAttendanceProgress,

      // lesson logs
      saveLessonLog,
 
      listLessonLogsByClassDate,

      // homework
      postHomework,
      listHomeworkByClass,

      // exams
      postExam,
      listExamsByClass,

      // issues
      createIssue,
      listIssues,
      updateIssueStatus,

      // reports
      reportSummary,
      listClasses,           
  
      attendanceRiskByClass,
      
      // --- ✅ NEW ACTIONS ---
      saveGoodDeed,
      listGoodDeeds,
      postCalendarEvent,
      listCalendarEvents,
      postNews,
      listNews,
    };

    if (!router[action]) {
      return json({ status: 'fail', message: 'Unknown action: ' + action });
}
    const result = router[action](payload);
    return json(result);
} catch (err) {
    return json({ status: 'error', message: String(err) });
}
}

/***** ================== HELPERS ================== *****/
function book() { return SpreadsheetApp.getActiveSpreadsheet(); }

// ถ้าไม่พบชีต ให้สร้างพร้อมใส่ header อัตโนมัติ
function getOrCreateSheet(name) {
  let sh = book().getSheetByName(name);
if (!sh) {
    sh = book().insertSheet(name);
    const header = SHEET_HEADERS[name] || [];
if (header.length) sh.getRange(1, 1, 1, header.length).setValues([header]);
  } else {
    // ถ้ามีชีตแต่ไม่มี header และเรารู้ header → เติมให้
    const lastCol = sh.getLastColumn();
if (lastCol === 0 && (SHEET_HEADERS[name]||[]).length) {
      const header = SHEET_HEADERS[name];
      sh.getRange(1, 1, 1, header.length).setValues([header]);
}
  }
  return sh;
}

// alias ที่รับประกันว่ามีชีตเสมอ
function sheet(name) { return getOrCreateSheet(name);
}

// อ่านทั้งชีตแบบ header-based -> array ของ object
function readAll(name) {
  const sh = sheet(name);
  const rng = sh.getDataRange();
const values = rng.getValues();
  if (!values || values.length < 2) return [];
// ไม่มีข้อมูล (หรือมีแต่ header)
  const header = values[0].map(h => String(h).trim());
  const rows = values.slice(1);
return rows.map(r => {
    const obj = {};
    header.forEach((h, i) => obj[h] = r[i]);
    return obj;
  });
}

// append แถวด้วย header mapping (ถ้า header ไม่มี จะสร้างให้)
function appendRow(name, obj) {
  const sh = sheet(name);
const rng = sh.getDataRange();
  const values = rng.getValues();
  if (!values || values.length === 0) {
    const header = (SHEET_HEADERS[name] && SHEET_HEADERS[name].length) ?
SHEET_HEADERS[name] : Object.keys(obj);
    sh.appendRow(header);
    sh.appendRow(header.map(h => obj.hasOwnProperty(h) ? obj[h] : ''));
    return;
  }
  const header = values[0].map(h => String(h).trim());
// กรณี header ยังไม่มีบางคอลัมน์ -> ขยาย header
  const needCols = Object.keys(obj).filter(k => header.indexOf(k) === -1);
if (needCols.length) {
    const newHeader = header.concat(needCols);
    sh.getRange(1, 1, 1, newHeader.length).setValues([newHeader]);
  }
  const finalHeader = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(h=>String(h).trim());
const row = finalHeader.map(h => obj.hasOwnProperty(h) ? obj[h] : '');
  sh.appendRow(row);
}

// upsert แถว (แก้ไขถ้ามี key ซ้ำ, ถ้าไม่มีให้เพิ่ม) โดยเทียบจากคอลัมน์ key
function upsertRow(name, keyCol, keyVal, obj) {
  const sh = sheet(name);
const values = sh.getDataRange().getValues();
  if (!values || values.length === 0) {
    const header = (SHEET_HEADERS[name] && SHEET_HEADERS[name].length) ?
SHEET_HEADERS[name] : Object.keys(obj);
    sh.appendRow(header);
    sh.appendRow(header.map(h => obj[h] || ''));
    return { updated: false, created: 1, row: 2 };
}
  const header = values[0].map(h => String(h).trim());
  // ensure header contains all keys
  const needCols = Object.keys(obj).filter(k => header.indexOf(k) === -1);
if (needCols.length) {
    const newHeader = header.concat(needCols);
    sh.getRange(1, 1, 1, newHeader.length).setValues([newHeader]);
  }
  const finalHeader = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(h=>String(h).trim());
const idx = {}; finalHeader.forEach((h, i) => idx[h] = i);

  // หาแถวที่ key ตรง
  const all = sh.getDataRange().getValues();
for (let r = 1; r < all.length; r++) {
    const rowKey = all[r][idx[keyCol]];
if (String(rowKey) === String(keyVal)) {
      // update row
      const rowVals = finalHeader.map(h => obj.hasOwnProperty(h) ? obj[h] : all[r][idx[h]]);
sh.getRange(r + 1, 1, 1, rowVals.length).setValues([rowVals]);
      return { updated: 1, created: 0, row: r + 1 };
}
  }
  // append ใหม่
  const row = finalHeader.map(h => obj.hasOwnProperty(h) ? obj[h] : '');
  sh.appendRow(row);
return { updated: 0, created: 1, row: sh.getLastRow() };
}

// ลบแถวตาม key
function deleteRowByKey(name, keyCol, keyVal) {
  const sh = sheet(name);
const values = sh.getDataRange().getValues();
  if (!values || values.length < 2) return { deleted: 0 };
const header = values[0].map(h => String(h).trim());
  const idx = {};
  header.forEach((h, i) => idx[h] = i);
for (let r = 1; r < values.length; r++) {
    const rowKey = values[r][idx[keyCol]];
if (String(rowKey) === String(keyVal)) {
      sh.deleteRow(r + 1);
return { deleted: 1, row: r + 1 };
    }
  }
  return { deleted: 0 };
}

function nowISO() { return new Date().toISOString(); }

function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}

function isActive(val) {
  const s = String(val || 'TRUE').toUpperCase();
return !(s === 'FALSE' || s === '0' || s === 'NO');
}

/***** ================== DOMAIN HELPERS ================== *****/
function findUser(username, password) {
  const users = readAll(SHEET.USERS);
return users.find(u =>
    String(u.UserID) === String(username) &&
    String(u.Password) === String(password) &&
    isActive(u.Active)
  );
}

// ดึงวิชาตามห้องเรียน (รองรับทั้ง map ตรง Class และ map ตาม ClassLevel ที่ prefix)
function subjectsByClass(cls) {
  const all = readAll(SHEET.SUBJECTS);
return all.filter(s => {
    if (!isActive(s.Active)) return false;
    if (String(s.Class || '') === String(cls)) return true;
    const lvl = String(s.ClassLevel || '').trim();
    return lvl && String(cls || '').startsWith(lvl); // เช่น ClassLevel=ม.5, Class=ม.5/2
  });
}

/***** ================== ACTIONS ================== *****/
// --- Auth ---
function loginUser(p) {
  const u = findUser(p.username, p.password);
if (!u) return { status: 'fail', message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' };
  return {
    status: 'success',
    user: {
      user_id: u.UserID,
      full_name: u.FullName,
      class_name: u.Class,
      role: u.Role,
      profile_url: u.ProfileURL ||
''
    }
  };
}

/* ===================== USERS ===================== */
// โครงสร้างชีต Users: UserID, Password, FullName, Class, Role, Active, ProfileURL
function getUsers(p) {
  const list = readAll(SHEET.USERS);
list.forEach(u => u.Active = isActive(u.Active));
  return { status: 'success', users: list };
}

// สร้าง/แก้ไขผู้ใช้จาก key=UserID
// payload: { user: {UserID, Password, FullName, Class, Role, Active('TRUE'|'FALSE'), ProfileURL} }
function upsertUser(p) {
  if (!p || !p.user || !p.user.UserID) return { status: 'fail', message: 'missing user or UserID' };
const u = p.user;
  const obj = {
    UserID: u.UserID,
    Password: u.Password ||
'',
    FullName: u.FullName || '',
    Class: u.Class ||
'',
    Role: u.Role || 'student',
    Active: (String(u.Active || 'TRUE').toUpperCase() === 'FALSE') ?
'FALSE' : 'TRUE',
    ProfileURL: u.ProfileURL || ''
  };
  const rs = upsertRow(SHEET.USERS, 'UserID', obj.UserID, obj);
return { status: 'success', result: rs };
}

// ลบผู้ใช้ตาม UserID
// payload: { userId: 'xxxxx' }
function deleteUser(p) {
  if (!p || !p.userId) return { status: 'fail', message: 'missing userId' };
const rs = deleteRowByKey(SHEET.USERS, 'UserID', p.userId);
  if (rs.deleted) return { status: 'success' };
return { status: 'fail', message: 'User not found' };
}

// ✅ NEW ACTION: 6. ติดต่อครูประจำชั้น (Get Class Teacher)
function getClassTeacher(p) {
  // p: { class: 'ม.x/y' }
  if (!p.class) return { status: 'fail', message: 'ระบุห้องเรียน' };
  const users = readAll(SHEET.USERS);
  // หาครูหรือแอดมินคนแรกที่ผูกกับห้องนั้นๆ
  const teacher = users.find(u => 
    String(u.Class) === String(p.class) && 
    (String(u.Role).toLowerCase() === 'teacher' || String(u.Role).toLowerCase() === 'admin') &&
    isActive(u.Active)
  );
  if (teacher) {
    return { 
      status: 'success', 
      teacher: {
        id: teacher.UserID,
        name: teacher.FullName,
        role: teacher.Role,
        class: teacher.Class,
        profile: teacher.ProfileURL,
      }
    };
  }
  return { status: 'fail', message: `ไม่พบครูประจำชั้นหรือผู้ดูแลห้อง ${p.class}` };
}


/* ===================== SUBJECTS ===================== */
function getSubjectsByClass(p) {
  const list = subjectsByClass(p.class);
return { status: 'success', subjects: list };
}

function getSubjectsForTeacher(p) {
  const all = readAll(SHEET.SUBJECTS);
const list = all.filter(s =>
    isActive(s.Active) &&
    (String(s.TeacherID) === String(p.teacherId) ||
     String(s.TeacherName) === String(p.teacherName))
  );
return { status: 'success', subjects: list };
}

/* ===================== ATTENDANCE ===================== */
function saveAttendanceBulk(p) {
  // p: { date, subjectId, subjectName, class, records:[{studentId,status,note}], recorderId }
  const ts = nowISO();
(p.records || []).forEach(r => {
    appendRow(SHEET.ATTEND, {
      Timestamp: ts,
      Date: p.date,
      SubjectID: p.subjectId,
      SubjectName: p.subjectName,
      Class: p.class,
      StudentID: r.studentId,
      Status: r.status || 'Present',
      Note: r.note || '',
      RecorderID: p.recorderId || ''
    });
  });
return { status: 'success', saved: (p.records || []).length };
}

function markAbsent(p) {
  // p: { date, subjectId, subjectName, class, studentIds:[], recorderId }
  const ts = nowISO();
(p.studentIds || []).forEach(id => {
    appendRow(SHEET.ATTEND, {
      Timestamp: ts,
      Date: p.date,
      SubjectID: p.subjectId,
      SubjectName: p.subjectName,
      Class: p.class,
      StudentID: id,
      Status: 'Absent',
      Note: '',
      RecorderID: p.recorderId || ''
    });
  });
return { status: 'success', saved: (p.studentIds || []).length };
}

function getAttendanceProgress(p) {
  // p: { userId }
  const users = readAll(SHEET.USERS);
const user = users.find(u => String(u.UserID) === String(p.userId));
  if (!user) return { status: 'fail', message: 'ไม่พบผู้ใช้' };
const cls = user.Class;
  const subs = subjectsByClass(cls); // ต้องมี CreditPerWeek
  const att = readAll(SHEET.ATTEND).filter(a =>
    String(a.StudentID) === String(p.userId) &&
    String(a.Class) === String(cls)
  );
const presentStatuses = new Set(['Present', 'Late', 'Leave']); // ปรับได้
  const progress = subs.map(s => {
    const required = Number(s.CreditPerWeek || 0) * WEEKS_PER_TERM;
    const attended = att.filter(a => String(a.SubjectID) === String(s.SubjectID) && presentStatuses.has(String(a.Status))).length;
    const pct = required > 0 ? Math.round((attended / required) * 100) : 0;
    return {
      subjectId: s.SubjectID,
      subjectName: s.SubjectName,
      requiredSessions: required,
      attendedSessions: attended,
      percent: pct,
    
    pass80: pct >= 80
    };
  });

  return { status: 'success', progress };
}

/* ===================== LESSON LOGS ===================== */
function saveLessonLog(p) {
  // p: { date, subjectId, subjectName, class, topic, summary, materialLink, teacherId, teacherName }
  appendRow(SHEET.LESSON, {
    Timestamp: nowISO(),
    Date: p.date,
    SubjectID: p.subjectId,
    SubjectName: p.subjectName,
    Class: p.class,
    Topic: p.topic,
    Summary: p.summary || '',
    MaterialLink: p.materialLink || '',
    TeacherID: p.teacherId || '',
    TeacherName: p.teacherName || ''
  });
return { status: 'success' };
}

function listLessonLogsByClassDate(p) {
  // p: { class, subjectId, date?
}
  let list = readAll(SHEET.LESSON).filter(x => String(x.Class) === String(p.class) && String(x.SubjectID) === String(p.subjectId));
if (p.date) list = list.filter(x => String(x.Date) === String(p.date));
  list.sort((a,b) => new Date(b.Date) - new Date(a.Date));
return { status: 'success', logs: list };
}

/* ===================== HOMEWORK ===================== */
function postHomework(p) {
  // p: { assignDate, subjectId, subjectName, class, title, detail, dueDate, attachmentLink, assignedBy }
  appendRow(SHEET.HOMEWORK, {
    Timestamp: nowISO(),
    AssignDate: p.assignDate,
    SubjectID: p.subjectId,
    SubjectName: p.subjectName,
    Class: p.class,
    Title: p.title,
    Detail: p.detail || '',
    DueDate: p.dueDate,
    AttachmentLink: p.attachmentLink || '',
    AssignedBy: p.assignedBy || ''
  });
return { status: 'success' };
}

function listHomeworkByClass(p) {
  // p: { class, subjectId?
}
  let list = readAll(SHEET.HOMEWORK).filter(x => String(x.Class) === String(p.class));
  if (p.subjectId) list = list.filter(x => String(x.SubjectID) === String(p.subjectId));
list.sort((a,b) => new Date(a.DueDate) - new Date(b.DueDate));
  return { status: 'success', homework: list };
}

/* ===================== EXAMS ===================== */
function postExam(p) {
  // p: { examDate, examTime, subjectId, subjectName, class, scope, location, seat, note, assignedBy }
  appendRow(SHEET.EXAMS, {
    Timestamp: nowISO(),
    ExamDate: p.examDate,
    ExamTime: p.examTime || '',
    SubjectID: p.subjectId,
    SubjectName: p.subjectName,
    Class: p.class,
    Scope: p.scope || '',
    Location: p.location || '',
    Seat: p.seat || '',
    Note: p.note || '',
    AssignedBy: p.assignedBy || ''
  });
return { status: 'success' };
}

function listExamsByClass(p) {
  // p: { class, subjectId?
}
  let list = readAll(SHEET.EXAMS).filter(x => String(x.Class) === String(p.class));
  if (p.subjectId) list = list.filter(x => String(x.SubjectID) === String(p.subjectId));
list.sort((a,b) => new Date(a.ExamDate) - new Date(b.ExamDate));
  return { status: 'success', exams: list };
}

/* ===================== ISSUES ===================== */
function createIssue(p) {
  // p: { createdBy, role, class, category, title, detail, attachmentLink }
  const issueId = 'ISS-' + Math.random().toString(36).slice(2, 8).toUpperCase();
appendRow(SHEET.ISSUES, {
    Timestamp: nowISO(),
    IssueID: issueId,
    CreatedBy: p.createdBy || '',
    Role: p.role || '',
    Class: p.class || '',
    Category: p.category || '',
    Title: p.title || '',
    Detail: p.detail || '',
    AttachmentLink: p.attachmentLink || '',
    Status: 'New',
    Assignee: '',
    UpdatedAt: '',
    ResolutionNote: ''
  });
return { status: 'success', issueId };
}

function listIssues(p) {
  // p: { status?, class?, createdBy?
}
  let list = readAll(SHEET.ISSUES);
  if (p.status) list = list.filter(x => String(x.Status) === String(p.status));
if (p.class) list = list.filter(x => String(x.Class) === String(p.class));
  if (p.createdBy) list = list.filter(x => String(x.CreatedBy) === String(p.createdBy));
list.sort((a,b) => new Date(b.Timestamp) - new Date(a.Timestamp));
  return { status: 'success', issues: list };
}

function updateIssueStatus(p) {
  // p: { issueId, status, assignee?, resolutionNote? }
  const sh = sheet(SHEET.ISSUES);
const values = sh.getDataRange().getValues();
  if (!values || values.length < 2) return { status: 'fail', message: 'No data' };
const header = values[0].map(h => String(h).trim());
  const idx = {};
  header.forEach((h, i) => idx[h] = i);
for (let r = 1; r < values.length; r++) {
    if (values[r][idx.IssueID] === p.issueId) {
      if (p.status != null) values[r][idx.Status] = p.status;
if (p.assignee != null) values[r][idx.Assignee] = p.assignee;
      if (p.resolutionNote != null) values[r][idx.ResolutionNote] = p.resolutionNote;
      values[r][idx.UpdatedAt] = nowISO();
sh.getRange(r + 1, 1, 1, values[r].length).setValues([values[r]]);
      return { status: 'success' };
}
  }
  return { status: 'fail', message: 'Issue not found' };
}

/* ===================== REPORTS ===================== */
function reportSummary(p) {
  // p: { class }
  const cls = p.class;
// ให้แน่ใจว่ามีทุกชีต (จะสร้างอัตโนมัติถ้ายังไม่มี)
  getOrCreateSheet(SHEET.SUBJECTS);
  getOrCreateSheet(SHEET.ATTEND);
  getOrCreateSheet(SHEET.HOMEWORK);
  getOrCreateSheet(SHEET.EXAMS);

  const subs = subjectsByClass(cls);
  const att = readAll(SHEET.ATTEND).filter(a => String(a.Class) === String(cls));
const hw = readAll(SHEET.HOMEWORK).filter(h => String(h.Class) === String(cls));
  const ex = readAll(SHEET.EXAMS).filter(e => String(e.Class) === String(cls));

  const bySub = {};
subs.forEach(s => bySub[s.SubjectID] = { subjectName: s.SubjectName, totalStudents: 0, present: 0 });
att.forEach(a => {
    if (!bySub[a.SubjectID]) return;
    if (!bySub[a.SubjectID].students) bySub[a.SubjectID].students = {};
    bySub[a.SubjectID].students[a.StudentID] = true;
    if (['Present', 'Late', 'Leave'].includes(String(a.Status))) bySub[a.SubjectID].present++;
  });
Object.values(bySub).forEach(o => {
    o.totalStudents = o.students ? Object.keys(o.students).length : 0;
    delete o.students;
  });
return {
    status: 'success',
    class: cls,
    subjects: subs,
    attendanceAgg: bySub,
    homeworkCount: hw.length,
    examsCount: ex.length
  };
}

  // ✅ รายชื่อห้อง (unique) จาก Subjects ที่ Active
function listClasses(p){
  const subs = readAll(SHEET.SUBJECTS).filter(s=>isActive(s.Active));
  const set = {};
subs.forEach(s=>{ const c=String(s.Class||'').trim(); if(c) set[c]=true; });
  return { status:'success', classes: Object.keys(set).sort() };
}

// ✅ ความเสี่ยงการเข้าเรียนต่อห้อง: ok / risk / fail
function attendanceRiskByClass(p){
  const cls = p.class;
  const users = readAll(SHEET.USERS).filter(u=>String(u.Class)===String(cls)&&isActive(u.Active));
const subs  = subjectsByClass(cls); // ต้องมี CreditPerWeek
  const att   = readAll(SHEET.ATTEND).filter(a=>String(a.Class)===String(cls));
  const presentStatuses = new Set(['Present','Late','Leave']);
// จำนวนครั้งที่ต้องเข้าเรียนต่อวิชา
  const req = {}; subs.forEach(s=>{ req[s.SubjectID] = Number(s.CreditPerWeek||0) * WEEKS_PER_TERM; });
// นับการเข้าเรียนต่อคนต่อวิชา
  const byStu = {}; users.forEach(u=>{ byStu[u.UserID] = { fullName:u.FullName, minPct:100, sub:{} }; });
att.forEach(a=>{
    if(!presentStatuses.has(String(a.Status))) return;
    const sid=String(a.StudentID); if(!byStu[sid]) return;
    const k=String(a.SubjectID); byStu[sid].sub[k]=(byStu[sid].sub[k]||0)+1;
  });
// คิดเปอร์เซ็นต์ขั้นต่ำสุดของแต่ละคน (ต่ำสุดในทุกวิชา)
  const out=[];
  Object.keys(byStu).forEach(sid=>{
    let minPct=100;
    Object.keys(req).forEach(k=>{
      const attended=byStu[sid].sub[k]||0;
      const required=req[k]||0;
      const pct=required>0?Math.round((attended/required)*100):0;
      minPct=Math.min(minPct,pct);
    });
    let status='ok';
    if(minPct<80) status='fail';
    else if(minPct<85) status='risk'; // เสี่ยงถ้าเฉียดเกณฑ์
    out.push({ studentId:sid, fullName:byStu[sid].fullName, minPercent:minPct, status });
  });
return { status:'success', class:cls, list: out };
}

/* ===================== ✅ NEW ACTIONS (3, 4, 7) ===================== */

// 3. บันทึกเด็กดี (Good Student Log)
function saveGoodDeed(p) {
  // p: { date, studentId, fullName, class, recordedByRole, recordedByID, subjectId?, subjectName?, deedTopic, deedDetail }
  if (!p.studentId || !p.deedTopic || !p.recordedByID || !p.recordedByRole) {
    return { status: 'fail', message: 'ข้อมูลไม่ครบถ้วน (นักเรียน, หัวข้อ, ผู้บันทึก)' };
  }
  const ts = nowISO();
  appendRow(SHEET.GOODDEEDS, {
    Timestamp: ts,
    Date: p.date,
    StudentID: p.studentId,
    FullName: p.fullName,
    Class: p.class,
    RecordedByRole: p.recordedByRole,
    RecordedByID: p.recordedByID,
    SubjectID: p.subjectId || '',
    SubjectName: p.subjectName || '',
    DeedTopic: p.deedTopic,
    DeedDetail: p.deedDetail || ''
  });
  return { status: 'success' };
}

function listGoodDeeds(p) {
  // p: { studentId?, class?, subjectId? }
  let list = readAll(SHEET.GOODDEEDS);
  
  if (p.studentId) list = list.filter(x => String(x.StudentID) === String(p.studentId));
  else if (p.class) list = list.filter(x => String(x.Class) === String(p.class));
  if (p.subjectId) list = list.filter(x => String(x.SubjectID) === String(p.subjectId));

  list.sort((a,b) => new Date(b.Timestamp) - new Date(a.Timestamp));
  return { status: 'success', deeds: list };
}

// 4. ปฏิทินกิจกรรม GATE (GATE Activity Calendar)
function postCalendarEvent(p) {
  // p: { date, title, detail, link, assignedBy, classLevel? }
  if (!p.date || !p.title) {
    return { status: 'fail', message: 'ระบุวันที่และหัวข้อกิจกรรม' };
  }
  appendRow(SHEET.CALENDAR, {
    Timestamp: nowISO(),
    Date: p.date,
    Title: p.title,
    Detail: p.detail || '',
    Link: p.link || '',
    AssignedBy: p.assignedBy || '',
    ClassLevel: p.classLevel || '',
  });
  return { status: 'success' };
}

function listCalendarEvents(p) {
  // p: { classLevel? } - ถ้าว่างจะเอามาทั้งหมด
  let list = readAll(SHEET.CALENDAR);
  
  if (p.classLevel) {
     const level = String(p.classLevel).split('/')[0].trim();
     list = list.filter(x => !x.ClassLevel || String(x.ClassLevel).startsWith(level));
  }
  
  list.sort((a,b) => new Date(a.Date) - new Date(b.Date)); // เรียงตามวันที่เร็วสุด
  return { status: 'success', events: list };
}

// 7. แจ้งข่าวสาร (News/Announcements)
function postNews(p) {
  // p: { title, detail, link, postedBy }
  if (!p.title) {
    return { status: 'fail', message: 'ระบุหัวข้อข่าวสาร' };
  }
  appendRow(SHEET.NEWS, {
    Timestamp: nowISO(),
    Date: new Date().toISOString().slice(0, 10),
    Title: p.title,
    Detail: p.detail || '',
    Link: p.link || '',
    PostedBy: p.postedBy || '',
  });
  return { status: 'success' };
}

function listNews(p) {
  // p: { }
  let list = readAll(SHEET.NEWS);
  list.sort((a,b) => new Date(b.Timestamp) - new Date(a.Timestamp));
  return { status: 'success', news: list };
}
