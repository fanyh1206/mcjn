/* =========================================================
   utils/date.js —— 跨日判断、天数差、周年判断、中文日期格式化
   全部基于设备本地时区自然日，不引入任何第三方库
   ========================================================= */
window.PM = window.PM || {};

PM.Date = (function () {
  var DAY = 86400000;

  // 取某时间戳/Date 的当天 00:00:00.000（本地时区）
  function startOfDay(input) {
    var d = input instanceof Date ? new Date(input.getTime()) : new Date(input || Date.now());
    d.setHours(0, 0, 0, 0);
    return d;
  }

  // 两个时间是否属于同一本地自然日
  function isSameLocalDay(t1, t2) {
    if (!t1 || !t2) return false;
    return startOfDay(t1).getTime() === startOfDay(t2).getTime();
  }

  // 昨天 00:00（相对某时刻）
  function startOfYesterday(input) {
    var d = startOfDay(input);
    return new Date(d.getTime() - DAY);
  }

  // 解析 "YYYY-MM-DD" 为本地当天 00:00（避免 UTC 偏移）
  function parseDateStr(str) {
    if (!str) return null;
    var p = String(str).split("-");
    if (p.length !== 3) return null;
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    d.setHours(0, 0, 0, 0);
    return isNaN(d.getTime()) ? null : d;
  }

  // 思念天数：今天 - 离世日期（自然日差）；离世当天为 0
  function daysGone(deathDateStr, now) {
    var death = parseDateStr(deathDateStr);
    if (!death) return 0;
    var today = startOfDay(now || Date.now());
    return Math.max(0, Math.round((today.getTime() - death.getTime()) / DAY));
  }

  // 周年数：离世 N 周年（月日匹配且年份差 >=1），返回 0 表示今天非周年
  function deathAnniversaryYears(deathDateStr, now) {
    var death = parseDateStr(deathDateStr);
    if (!death) return 0;
    var today = startOfDay(now || Date.now());
    if (death.getMonth() === today.getMonth() && death.getDate() === today.getDate()) {
      var years = today.getFullYear() - death.getFullYear();
      if (years >= 1) return years;
    }
    return 0;
  }

  // 今天是否为宠物生日（月日匹配）
  function isBirthday(birthdayStr, now) {
    var b = parseDateStr(birthdayStr);
    if (!b) return false;
    var today = startOfDay(now || Date.now());
    return b.getMonth() === today.getMonth() && b.getDate() === today.getDate();
  }

  // 中文日期：2026年9月3日（月/日不补前导零）
  function formatDateCN(input) {
    var d;
    if (typeof input === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input)) {
      d = parseDateStr(input);
    } else {
      d = input instanceof Date ? input : new Date(input || Date.now());
    }
    if (!d || isNaN(d.getTime())) return "";
    var y = d.getFullYear();
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return y + "年" + m + "月" + day + "日";
  }

  // 留言/时间戳的中文展示：2026-09-03 20:15
  function formatDateTimeCN(ts) {
    var d = new Date(ts);
    if (isNaN(d.getTime())) return "";
    var hh = String(d.getHours()).padStart(2, "0");
    var mm = String(d.getMinutes()).padStart(2, "0");
    var y = d.getFullYear();
    var mo = String(d.getMonth() + 1).padStart(2, "0");
    var da = String(d.getDate()).padStart(2, "0");
    return y + "-" + mo + "-" + da + " " + hh + ":" + mm;
  }

  // 今天 YYYY-MM-DD
  function todayStr(now) {
    var d = startOfDay(now || Date.now());
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var da = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + da;
  }

  // 距离当天 23:59:59.000 的毫秒数
  function msToEndOfDay(now) {
    var d = startOfDay(now || Date.now());
    var end = new Date(d.getTime() + DAY - 1000); // 23:59:59.000
    return end.getTime() - (now || Date.now());
  }

  return {
    DAY: DAY,
    startOfDay: startOfDay,
    startOfYesterday: startOfYesterday,
    isSameLocalDay: isSameLocalDay,
    parseDateStr: parseDateStr,
    daysGone: daysGone,
    deathAnniversaryYears: deathAnniversaryYears,
    isBirthday: isBirthday,
    formatDateCN: formatDateCN,
    formatDateTimeCN: formatDateTimeCN,
    todayStr: todayStr,
    msToEndOfDay: msToEndOfDay
  };
})();
