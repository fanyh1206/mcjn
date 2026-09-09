/* =========================================================
   pages/form.js —— 信息填写页
   字段校验、草稿实时暂存、照片压缩预览、开始仪式
   ========================================================= */
window.PM = window.PM || {};

PM.Form = (function () {
  var handlers = {};
  var photo = null; // { blob, url, width, height }
  var bound = false;

  function el(id) { return document.getElementById(id); }
  function fieldOf(name) {
    var input = document.querySelector('[name="' + name + '"]');
    return input ? input.closest(".field") : null;
  }
  function setErr(name, msg) {
    var f = fieldOf(name);
    var e = document.querySelector('[data-err="' + name + '"]');
    if (e) e.textContent = msg || "";
    if (f) f.classList.toggle("invalid", !!msg);
  }
  function clearErrs() {
    ["ownerName", "petName", "birthday", "deathDate", "photo", "words"].forEach(function (n) { setErr(n, ""); });
  }

  function collect() {
    var gender = document.querySelector('input[name="gender"]:checked');
    return {
      ownerName: el("f-owner").value.trim(),
      petName: el("f-pet").value.trim(),
      birthday: el("f-birthday").value,
      deathDate: el("f-death").value,
      gender: gender ? gender.value : "secret",
      breed: el("f-breed").value.trim(),
      words: el("f-words").value.trim()
    };
  }

  function validate(showErrors) {
    var v = collect();
    var today = PM.Date.todayStr();
    var ok = true;
    var firstBad = null;
    var firstMsg = "";

    function fail(name, msg) {
      ok = false;
      if (showErrors) setErr(name, msg);
      if (!firstBad) { firstBad = name; firstMsg = msg; }
    }

    if (!v.ownerName) fail("ownerName", "请填写主人名称");
    else if (v.ownerName.length > 20) fail("ownerName", "名字控制在 20 字以内就好");
    else if (showErrors) setErr("ownerName", "");

    if (!v.petName) fail("petName", "请填写它的名字");
    else if (v.petName.length > 20) fail("petName", "名字控制在 20 字以内就好");
    else if (showErrors) setErr("petName", "");

    if (!v.birthday) fail("birthday", "请选择它的生日");
    else if (showErrors) setErr("birthday", "");

    if (!v.deathDate) fail("deathDate", "请选择离世日期");
    else if (showErrors) setErr("deathDate", "");

    if (v.birthday && v.deathDate) {
      if (v.birthday > v.deathDate) fail("birthday", "生日不应晚于离世日期");
      if (v.deathDate < v.birthday) fail("deathDate", "离世日期不应早于生日");
    }
    if (v.birthday && v.birthday > today) fail("birthday", "生日不能晚于今天");
    if (v.deathDate && v.deathDate > today) fail("deathDate", "离世日期不能晚于今天");

    if (!photo) fail("photo", "请选择一张它的照片");
    else if (showErrors) setErr("photo", "");

    if (v.words.length > 500) fail("words", "想说的话控制在 500 字以内");

    if (!ok && showErrors && firstBad) {
      var node = document.querySelector('[name="' + firstBad + '"]') || el("photo-picker");
      if (node && node.scrollIntoView) node.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    return { ok: ok, value: v, firstBad: firstBad, firstMsg: firstMsg };
  }

  // 按钮保持可点：校验失败时由点击回调给出 toast 提示（禁用会导致点了没反应）
  function refreshStartBtn() {
    validate(false);
  }

  function saveDraft() {
    var v = collect();
    PM.Store.saveDraft(v);
  }

  // ---------- 照片选择 ----------
  function onPickFile(file) {
    var check = PM.Image.validate(file);
    if (!check.ok) {
      setErr("photo", check.msg);
      PM.UI.toast(check.msg);
      return;
    }
    setErr("photo", "");
    PM.Image.compress(file).then(function (res) {
      if (photo && photo.url) URL.revokeObjectURL(photo.url);
      photo = { blob: res.blob, url: res.url, width: res.width, height: res.height };
      var img = el("photo-preview");
      img.src = res.url;
      img.hidden = false;
      el("photo-empty").style.display = "none";
      refreshStartBtn();
    }).catch(function () {
      setErr("photo", "这张照片好像打不开，换一张试试");
    });
  }

  function resetPhoto() {
    photo = null;
    el("photo-preview").hidden = true;
    el("photo-preview").src = "";
    el("photo-empty").style.display = "";
  }

  // ---------- 生命周期 ----------
  function init(h) {
    handlers = h || {};
    if (bound) return;
    bound = true;

    el("photo-picker").addEventListener("click", function () { el("f-photo").click(); });
    el("f-photo").addEventListener("change", function (e) {
      if (e.target.files && e.target.files[0]) onPickFile(e.target.files[0]);
      e.target.value = "";
    });

    // 实时暂存 + 校验
    ["f-owner", "f-pet", "f-birthday", "f-death", "f-breed", "f-words"].forEach(function (id) {
      el(id).addEventListener("input", function () { saveDraft(); refreshStartBtn(); });
      el(id).addEventListener("change", function () { saveDraft(); refreshStartBtn(); });
    });
    document.querySelectorAll('input[name="gender"]').forEach(function (r) {
      r.addEventListener("change", saveDraft);
    });

    el("btn-start").addEventListener("click", function () {
      var r = validate(true);
      if (!r.ok) {
        PM.UI.toast(r.firstMsg || "还有几处想请你确认一下");
        return;
      }
      handlers.onStart && handlers.onStart(r.value, photo);
    });
  }

  function show(data) {
    clearErrs();
    // 优先用草稿恢复；日期无值时默认当天
    var draft = PM.Store.loadDraft();
    var src = draft || (data && data.pet) || {};
    var today = PM.Date.todayStr();
    el("f-owner").value = src.ownerName || "";
    el("f-pet").value = src.petName || "";
    el("f-birthday").value = src.birthday || today;
    el("f-death").value = src.deathDate || today;
    el("f-breed").value = src.breed || "";
    el("f-words").value = src.words || "";
    var g = src.gender || "secret";
    var radio = document.querySelector('input[name="gender"][value="' + g + '"]');
    if (radio) radio.checked = true;
    resetPhoto();
    refreshStartBtn();
    document.getElementById("view-form").hidden = false;
  }

  return { init: init, show: show, validate: validate };
})();
