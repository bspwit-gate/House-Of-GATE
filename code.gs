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
  TIMETABLE: 'Timetable', // ✅ ADDED
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
  [SHEET.TIMETABLE]: ['Class', 'DayOfWeek', 'SubjectID', 'SubjectName'], // ✅ ADDED
};
/***** ================== ENTRYPOINT ================== *****/
function doGet(e) {
  return HtmlService.createHtmlOutput('LMS GAS API is running ✅');
}

function doPost(e) {
  try {
    const body = e && e.postData && e.postData.contents ?
    JSON.parse(e.postData.contents) : {};
    const action = body.action;
    const payload = body.payload || {};
    const router = {
      loginUser,
      getUsers,
      upsertUser,
      deleteUser,
      getClassTeacher,
      getUsersByClass, 
      getSubjectsByClass,
      getSubjectsForTeacher,
      upsertSubject, 
      deleteSubject, 
      saveAttendanceBulk, 
      markAbsent,
      getAttendanceProgress, 
      saveLessonLog,
      listLessonLogsByClassDate,
      postHomework,
      listHomeworkByClass,
      postExam,
      listExamsByClass,
      createIssue,
      listIssues,
      updateIssueStatus,
      reportSummary,
      listClasses, 
      attendanceRiskByClass,
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

function getOrCreateSheet(name) {
  let sh = book().getSheetByName(name);
  if (!sh) {
    sh = book().insertSheet(name);
    const header = SHEET_HEADERS[name] || [];
    if (header.length) sh.getRange(1, 1, 1, header.length).setValues([header]);
  } else {
    const lastCol = sh.getLastColumn();
    if (lastCol === 0 && (SHEET_HEADERS[name]||[]).length) {
      const header = SHEET_HEADERS[name];
      sh.getRange(1, 1, 1, header.length).setValues([header]);
    }
  }
  return sh;
}

function sheet(name) { return getOrCreateSheet(name);
}

function readAll(name) {
  const sh = sheet(name);
  const rng = sh.getDataRange();
  const values = rng.getValues();
  if (!values || values.length < 2) return [];
  const header = values[0].map(h => String(h).trim());
  const rows = values.slice(1);
  return rows.map(r => {
    const obj = {};
    header.forEach((h, i) => obj[h] = r[i]);
    return obj;
  });
}

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
  const needCols = Object.keys(obj).filter(k => header.indexOf(k) === -1);
  if (needCols.length) {
    const newHeader = header.concat(needCols);
    sh.getRange(1, 1, 1, newHeader.length).setValues([newHeader]);
  }
  const finalHeader = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(h=>String(h).trim());
  const row = finalHeader.map(h => obj.hasOwnProperty(h) ? obj[h] : '');
  sh.appendRow(row);
}

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
  const needCols = Object.keys(obj).filter(k => header.indexOf(k) === -1);
  if (needCols.length) {
    const newHeader = header.concat(needCols);
    sh.getRange(1, 1, 1, newHeader.length).setValues([newHeader]);
  }
  const finalHeader = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(h=>String(h).trim());
  const idx = {}; finalHeader.forEach((h, i) => idx[h] = i);
  const all = sh.getDataRange().getValues();
  for (let r = 1; r < all.length; r++) {
    const rowKey = all[r][idx[keyCol]];
    if (String(rowKey) === String(keyVal)) {
      const rowVals = finalHeader.map(h => obj.hasOwnProperty(h) ? obj[h] : all[r][idx[h]]);
      sh.getRange(r + 1, 1, 1, rowVals.length).setValues([rowVals]);
      return { updated: 1, created: 0, row: r + 1 };
    }
  }
  const row = finalHeader.map(h => obj.hasOwnProperty(h) ? obj[h] : '');
  sh.appendRow(row);
  return { updated: 0, created: 1, row: sh.getLastRow() };
}

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

// ✅ NEW HELPER: ฟังก์ชัน Normalize Class (สำคัญที่สุด)
function normalizeClass(cls) {
    if (!cls) return '';
    let s = String(cls).trim().toUpperCase();
    s = s.replace(/ม\./g, ''); // Remove ม. (ม.6/10 -> 6/10)
    s = s.replace(/ /g, ''); // Remove internal spaces just in case
    return s;
}


// ✅ NEW HELPER: แปลงวันที่เป็นชื่อวัน (ภาษาไทย)
function getDayOfWeekName(dateString) {
  const date = new Date(dateString + 'T00:00:00'); 
  if (isNaN(date.getTime())) return null;
  const days = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
  return days[date.getDay()];
}

// ✅ NEW HELPER: ดึงวิชาตามห้องและวัน (ปรับปรุงการดึง Subjects)
function getSubjectsByClassAndDay(cls, dayName) {
  const timetable = readAll(SHEET.TIMETABLE);
  const targetCls = normalizeClass(cls); // ใช้ Normalized Class
  
  if (!timetable || timetable.length === 0) {
    return subjectsByClass(cls).map(s => ({ id: s.SubjectID, name: s.SubjectName }));
  }

  const list = timetable.filter(t => 
    normalizeClass(t.Class) === targetCls && // เทียบด้วย Normalized Class
    String(t.DayOfWeek || '').trim() === dayName
  ).map(t => ({ id: t.SubjectID, name: t.SubjectName }));
  
  if (list.length === 0) {
     return subjectsByClass(cls).map(s => ({ id: s.SubjectID, name: s.SubjectName }));
  }

  const allSubjects = readAll(SHEET.SUBJECTS);
  const finalSubjects = list.map(t => {
    const subjectDetail = allSubjects.find(s => String(s.SubjectID) === String(t.id));
    return {
        id: t.id,
        name: t.name,
        creditPerWeek: Number(subjectDetail?.CreditPerWeek || 0)
    };
  });

  return finalSubjects;
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

// ✅ MODIFIED: Trim input cls and stored subject class (ใช้ normalizeClass)
function subjectsByClass(cls) {
  const targetCls = String(cls || '').trim(); // ใช้ Trimmed Class สำหรับ Subjects (เพราะ Subjects ใช้ Class/ClassLevel)
  const all = readAll(SHEET.SUBJECTS);
  return all.filter(s => {
    if (!isActive(s.Active)) return false;
    // Match 1: Trimmed Subject Class vs Trimmed Target Class
    if (String(s.Class || '').trim() === targetCls) return true; 
    // Match 2: Level prefix match
    const lvl = String(s.ClassLevel || '').trim();
    return lvl && targetCls.startsWith(lvl); 
  });
}

/***** ================== ACTIONS ================== *****/
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
      profile_url: u.ProfileURL || ''
    }
  };
}

/* ===================== USERS ===================== */
function getUsers(p) {
  const list = readAll(SHEET.USERS);
  list.forEach(u => u.Active = isActive(u.Active));
  return { status: 'success', users: list };
}

// ✅ ADDED FIX: ดึงรายชื่อนักเรียนตามห้อง (ใช้ normalizeClass)
function getUsersByClass(p) {
  if (!p.class) return { status: 'fail', message: 'ระบุห้องเรียน' };
  
  const targetClass = normalizeClass(p.class); // ใช้ Normalized Class
  
  const users = readAll(SHEET.USERS);
  const list = users.filter(u => 
    normalizeClass(u.Class) === targetClass && // เทียบด้วย Normalized Class
    String(u.Role).toLowerCase() === 'student' &&
    isActive(u.Active)
  );
  list.sort((a,b) => String(a.UserID).localeCompare(String(b.UserID), 'th', {numeric: true}));
  return { status: 'success', users: list };
}

function upsertUser(p) {
  if (!p || !p.user || !p.user.UserID) return { status: 'fail', message: 'missing user or UserID' };
  const u = p.user;
  const obj = {
    UserID: u.UserID,
    Password: u.Password || '',
    FullName: u.FullName || '',
    Class: u.Class || '',
    Role: u.Role || 'student',
    Active: (String(u.Active || 'TRUE').toUpperCase() === 'FALSE') ? 'FALSE' : 'TRUE',
    ProfileURL: u.ProfileURL || ''
  };
  const rs = upsertRow(SHEET.USERS, 'UserID', obj.UserID, obj);
  return { status: 'success', result: rs };
}

function deleteUser(p) {
  if (!p.userId) return { status: 'fail', message: 'missing userId' };
  const rs = deleteRowByKey(SHEET.USERS, 'UserID', p.userId);
  if (rs.deleted) return { status: 'success' };
  return { status: 'fail', message: 'User not found' };
}

function getClassTeacher(p) {
  if (!p.class) return { status: 'fail', message: 'ระบุห้องเรียน' };
  const users = readAll(SHEET.USERS);
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

function upsertSubject(p) {
  if (!p || !p.SubjectID || !p.SubjectName || !p.Class) {
    return { status: 'fail', message: 'ข้อมูลวิชาไม่ครบถ้วน (รหัสวิชา, ชื่อวิชา, ห้อง)' };
  }
  const obj = {
    SubjectID: p.SubjectID,
    SubjectName: p.SubjectName,
    CreditPerWeek: Number(p.CreditPerWeek || 0),
    TeacherID: p.TeacherID || '',
    TeacherName: p.TeacherName || '',
    Class: p.Class,
    ClassLevel: p.ClassLevel || '',
    Active: (String(p.Active || 'TRUE').toUpperCase() === 'FALSE') ? 'FALSE' : 'TRUE',
  };
  const rs = upsertRow(SHEET.SUBJECTS, 'SubjectID', obj.SubjectID, obj);
  return { status: 'success', result: rs };
}

function deleteSubject(p) {
  if (!p.subjectId) return { status: 'fail', message: 'missing subjectId' };
  const rs = deleteRowByKey(SHEET.SUBJECTS, 'SubjectID', p.subjectId);
  if (rs.deleted) return { status: 'success' };
  return { status: 'fail', message: 'Subject not found' };
}


/* ===================== ATTENDANCE ===================== */
function saveAttendanceBulk(p) {
  const subjectsToSave = [];
  if (p.subjectId === 'ALL_DAY') {
    const dayName = getDayOfWeekName(p.date);
    if (!dayName) return { status: 'fail', message: 'ไม่สามารถระบุวันในสัปดาห์จากวันที่ที่ป้อนได้' };

    const subjectsForDay = getSubjectsByClassAndDay(p.class, dayName);
    
    subjectsForDay.forEach(s => subjectsToSave.push({ id: s.id, name: s.name }));
  } else {
    subjectsToSave.push({ id: p.subjectId, name: p.subjectName });
  }

  const ts = nowISO();
  let savedCount = 0;

  subjectsToSave.forEach(sub => {
    (p.records || []).forEach(r => {
      appendRow(SHEET.ATTEND, {
        Timestamp: ts,
        Date: p.date,
        SubjectID: sub.id,
        SubjectName: sub.name,
        Class: p.class,
        StudentID: r.studentId,
        Status: r.status || 'Present',
        Note: r.note || '',
        RecorderID: p.recorderId || ''
      });
      savedCount++;
    });
  });
  
  return { status: 'success', saved: savedCount };
}

function markAbsent(p) {
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
  if (!p.userId) return { status: 'fail', message: 'Missing userId' };
  const users = readAll(SHEET.USERS);
  const user = users.find(u => String(u.UserID) === String(p.userId));
  if (!user) return { status: 'fail', message: 'ไม่พบผู้ใช้' };
  
  // ✅ FIX: ใช้ Normalized Class จาก User
  const userClassNormalized = normalizeClass(user.Class);
  
  // ✅ FIX: ส่ง user.Class (original value) ให้ subjectsByClass เพื่อให้ตรรกะ ClassLevel (ม.5) ยังทำงานได้
  const subs = subjectsByClass(user.Class); 
  
  // ✅ FIX: ดึง ATTENDANCE RECORDS และเปรียบเทียบด้วย Normalized Class
  const att = readAll(SHEET.ATTEND).filter(a =>
    String(a.StudentID) === String(p.userId) &&
    normalizeClass(a.Class) === userClassNormalized // ตรวจสอบ Class โดย Normalized ทั้งสองฝั่ง
  );
  
  const attendedStatuses = new Set(['Present', 'Late', 'SickLeave', 'PersonalLeave']);
  
  const progress = subs.map(s => {
    const subjectAtt = att.filter(a => String(a.SubjectID) === String(s.SubjectID));
    
    const attended = subjectAtt.filter(a => attendedStatuses.has(String(a.Status))).length;
    const totalChecked = subjectAtt.length;
    
    const pct = totalChecked > 0 ? Math.min(100, Math.round((attended / totalChecked) * 100)) : 0;
    
    const required = Number(s.CreditPerWeek || 0) * WEEKS_PER_TERM;

    return {
      subjectId: s.SubjectID,
      subjectName: s.SubjectName,
      requiredSessions: required, 
      attendedSessions: attended, 
      totalChecked: totalChecked, 
      percent: pct,
      pass80: pct >= 80
    };
  });

  return { status: 'success', progress };
}

/* ===================== LESSON LOGS ===================== */
function saveLessonLog(p) {
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
  const list = readAll(SHEET.LESSON).filter(x => String(x.Class) === String(p.class) && String(x.SubjectID) === String(p.subjectId));
  if (p.date) list = list.filter(x => String(x.Date) === String(p.date));
  list.sort((a,b) => new Date(b.Date) - new Date(a.Date));
  return { status: 'success', logs: list };
}

/* ===================== HOMEWORK ===================== */
function postHomework(p) {
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
  let list = readAll(SHEET.HOMEWORK).filter(x => String(x.Class) === String(p.class));
  if (p.subjectId) list = list.filter(x => String(x.SubjectID) === String(p.subjectId));
list.sort((a,b) => new Date(a.DueDate) - new Date(b.DueDate));
  return { status: 'success', homework: list };
}

/* ===================== EXAMS ===================== */
function postExam(p) {
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
  let list = readAll(SHEET.EXAMS).filter(x => String(x.Class) === String(p.class));
  if (p.subjectId) list = list.filter(x => String(x.SubjectID) === String(p.subjectId));
list.sort((a,b) => new Date(a.ExamDate) - new Date(b.ExamDate));
  return { status: 'success', exams: list };
}

/* ===================== ISSUES ===================== */
function createIssue(p) {
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
  let list = readAll(SHEET.ISSUES);
  if (p.status) list = list.filter(x => String(x.Status) === String(p.status));
if (p.class) list = list.filter(x => String(x.Class) === String(p.class));
  if (p.createdBy) list = list.filter(x => String(x.CreatedBy) === String(p.createdBy));
list.sort((a,b) => new Date(b.Timestamp) - new Date(a.Timestamp));
  return { status: 'success', issues: list };
}

function updateIssueStatus(p) {
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
  const cls = p.class;
  getOrCreateSheet(SHEET.SUBJECTS);
  getOrCreateSheet(SHEET.ATTEND);
  getOrCreateSheet(SHEET.HOMEWORK);
  getOrCreateSheet(SHEET.EXAMS);

  const subs = subjectsByClass(cls);
  const att = readAll(SHEET.ATTEND).filter(a => String(a.Class) === String(cls));
  const hw = readAll(SHEET.HOMEWORK).filter(h => String(h.Class) === String(cls));
  const ex = readAll(SHEET.EXAMS).filter(e => String(h.Class) === String(cls));

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

function listClasses(p){
  const subs = readAll(SHEET.SUBJECTS).filter(s=>isActive(s.Active));
  const set = {};
  subs.forEach(s=>{ const c=String(s.Class||'').trim(); if(c) set[c]=true; }); 
  return { status:'success', classes: Object.keys(set).sort() };
}

function attendanceRiskByClass(p){
  const cls = p.class;
  const users = readAll(SHEET.USERS).filter(u=>String(u.Class)===String(cls)&&isActive(u.Active));
  const subs  = subjectsByClass(cls); // ต้องมี CreditPerWeek
  const att   = readAll(SHEET.ATTEND).filter(a=>String(a.Class)===String(cls));
  const presentStatuses = new Set(['Present','Late','Leave']);
  const req = {}; subs.forEach(s=>{ req[s.SubjectID] = Number(s.CreditPerWeek||0) * WEEKS_PER_TERM; });
  const byStu = {}; users.forEach(u=>{ byStu[u.UserID] = { fullName:u.FullName, minPct:100, sub:{} }; });
  att.forEach(a=>{
    if(!presentStatuses.has(String(a.Status))) return;
    const sid=String(a.StudentID); if(!byStu[sid]) return;
    const k=String(a.SubjectID); byStu[sid].sub[k]=(byStu[sid].sub[k]||0)+1;
  });
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
    else if(minPct<85) status='risk'; 
    out.push({ studentId:sid, fullName:byStu[sid].fullName, minPercent:minPct, status });
  });
  return { status:'success', class:cls, list: out };
}

/* ===================== NEW ACTIONS ===================== */

function saveGoodDeed(p) {
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
  let list = readAll(SHEET.GOODDEEDS);
  
  if (p.studentId) list = list.filter(x => String(x.StudentID) === String(p.studentId));
  else if (p.class) list = list.filter(x => String(x.Class) === String(p.class));
  if (p.subjectId) list = list.filter(x => String(x.SubjectID) === String(p.subjectId));
  list.sort((a,b) => new Date(b.Timestamp) - new Date(a.Timestamp));
  return { status: 'success', deeds: list };
}

function postCalendarEvent(p) {
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
  let list = readAll(SHEET.CALENDAR);
  
  if (p.classLevel) {
     const level = String(p.classLevel).split('/')[0].trim();
  list = list.filter(x => !x.ClassLevel || String(x.ClassLevel).startsWith(level));
  }
  
  list.sort((a,b) => new Date(a.Date) - new Date(b.Date));
  return { status: 'success', events: list };
}

function postNews(p) {
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
  return { status: 'success', message: 'ประกาศสำเร็จ' };
}

function listNews(p) {
  let list = readAll(SHEET.NEWS);
  list.sort((a,b) => new Date(b.Timestamp) - new Date(a.Timestamp));
  return { status: 'success', news: list };
}