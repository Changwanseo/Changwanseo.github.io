/**
 * ============================================================================
 *  방명록 백엔드 (Google Apps Script + Google Sheets)
 * ============================================================================
 *
 *  ▶ 설치 방법
 *  1. Google 스프레드시트를 새로 만듭니다. (아무 이름, 예: "청첩장 방명록")
 *  2. 상단 메뉴 [확장 프로그램] → [Apps Script] 를 엽니다.
 *  3. 기본으로 생긴 코드(Code.gs)를 모두 지우고, 이 파일 내용을 전부 붙여넣습니다.
 *  4. 저장(💾) 후, 우측 상단 [배포] → [새 배포] 를 클릭합니다.
 *  5. 유형 선택(톱니바퀴) → [웹 앱] 선택.
 *       - 실행 계정:  나
 *       - 액세스 권한: "모든 사용자" (Anyone)
 *  6. [배포] → 권한 승인(본인 구글 계정) → "웹 앱 URL"을 복사합니다.
 *       (형식: https://script.google.com/macros/s/AKfy....../exec)
 *  7. index.html 의  var GUESTBOOK_API = '';  에 그 URL을 붙여넣고 저장/푸시합니다.
 *
 *  ▶ 코드를 수정한 뒤에는
 *     [배포] → [배포 관리] → 기존 배포 [편집(연필)] → 버전 "새 버전" → [배포]
 *     로 다시 배포해야 반영됩니다. (URL 은 그대로 유지됩니다)
 *
 *  ▶ 저장 위치
 *     같은 스프레드시트의 "guestbook" 시트에 한 줄씩 쌓입니다.
 *     비밀번호는 평문이 아니라 SHA-256 해시로 저장되어 시트에서도 원문이 보이지 않습니다.
 * ============================================================================
 */

var SHEET_NAME = 'guestbook';
var MAX_LEN = 100;             // 메시지 최대 글자수(한글 기준)
var SALT = 'changwan-sumin-2026'; // 비밀번호 해시용 소금값 (원하면 아무 문자열로 변경)

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(['id', 'name', 'passwordHash', 'message', 'timestamp']);
  }
  return sheet;
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function hash_(password) {
  var raw = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, SALT + '|' + password, Utilities.Charset.UTF_8);
  return raw.map(function(b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

// 이모지/그림문자 제거 (프론트와 동일한 규칙, 서버측 방어)
function stripEmoji_(str) {
  if (!str) return '';
  return String(str)
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
    .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, '')
    .replace(/[\u200D\uFE0E\uFE0F\u20E3]/gu, '')
    .replace(/[\u2190-\u21FF\u2300-\u27BF\u2B00-\u2BFF]/gu, '');
}

function clean_(str, limit) {
  var v = stripEmoji_(str).replace(/\r\n/g, '\n').trim();
  var arr = Array.from(v);
  if (limit && arr.length > limit) v = arr.slice(0, limit).join('');
  return v;
}

// ---- 목록 조회 (GET ?action=list) ------------------------------------------
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'list';
  if (action !== 'list') return json_({ ok: false, error: 'unknown action' });

  var sheet = getSheet_();
  var values = sheet.getDataRange().getValues();
  var entries = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (!row[0]) continue;
    entries.push({
      id: String(row[0]),
      name: String(row[1]),
      message: String(row[3]),
      ts: row[4] ? new Date(row[4]).getTime() : null
    });
  }
  entries.reverse(); // 최신순
  return json_({ ok: true, entries: entries });
}

// ---- 등록 / 삭제 (POST) -----------------------------------------------------
function doPost(e) {
  var data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'bad request' });
  }

  var action = data.action;
  if (action === 'add') return addEntry_(data);
  if (action === 'delete') return deleteEntry_(data);
  if (action === 'edit') return editEntry_(data);
  return json_({ ok: false, error: 'unknown action' });
}

function addEntry_(data) {
  var name = clean_(data.name, 20).replace(/\n/g, ' ');
  var message = clean_(data.message, MAX_LEN);
  var password = data.password ? String(data.password) : '';

  if (!name) return json_({ ok: false, error: '이름을 입력해주세요.' });
  if (!password) return json_({ ok: false, error: '비밀번호를 입력해주세요.' });
  if (!message) return json_({ ok: false, error: '메시지를 입력해주세요.' });

  var sheet = getSheet_();
  var id = String(new Date().getTime()) + '-' + Math.floor(Math.random() * 100000);
  sheet.appendRow([id, name, hash_(password), message, new Date()]);
  return json_({ ok: true, id: id });
}

function findRow_(sheet, id) {
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(id)) {
      return { rowIndex: i + 1, row: values[i] };
    }
  }
  return null;
}

function deleteEntry_(data) {
  var sheet = getSheet_();
  var found = findRow_(sheet, data.id);
  if (!found) return json_({ ok: false, error: '글을 찾을 수 없습니다.' });
  if (found.row[2] !== hash_(String(data.password || ''))) {
    return json_({ ok: false, error: '비밀번호가 일치하지 않습니다.' });
  }
  sheet.deleteRow(found.rowIndex);
  return json_({ ok: true });
}

function editEntry_(data) {
  var sheet = getSheet_();
  var found = findRow_(sheet, data.id);
  if (!found) return json_({ ok: false, error: '글을 찾을 수 없습니다.' });
  if (found.row[2] !== hash_(String(data.password || ''))) {
    return json_({ ok: false, error: '비밀번호가 일치하지 않습니다.' });
  }
  var message = clean_(data.message, MAX_LEN);
  if (!message) return json_({ ok: false, error: '메시지를 입력해주세요.' });
  sheet.getRange(found.rowIndex, 4).setValue(message);
  return json_({ ok: true });
}
