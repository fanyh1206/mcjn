/* =========================================================
   pages/settings.js —— 设置与数据管理
   修改信息 / 更换碑上照片 / 导出备份 / 导入恢复 / 重建 / 空间占用 / 隐私说明
   ========================================================= */
window.PM = window.PM || {};

PM.Settings = (function () {
  var data = null, onChanged = null;

  function h(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "class") e.className = attrs[k];
      else if (k === "text") e.textContent = attrs[k];
      else if (k === "html") e.innerHTML = attrs[k];
      else if (k.indexOf("on") === 0) e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }

  function dataURLToBlob(dataURL) {
    var parts = dataURL.split(",");
    var mime = (parts[0].match(/:(.*?);/) || [])[1] || "image/jpeg";
    var bstr = atob(parts[1]);
    var n = bstr.length;
    var u8 = new Uint8Array(n);
    while (n--) u8[n] = bstr.charCodeAt(n);
    return new Blob([u8], { type: mime });
  }
  function blobToDataURL(blob) {
    return new Promise(function (resolve) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.readAsDataURL(blob);
    });
  }

  // ---------- 修改信息 ----------
  function buildEditGroup() {
    var p = data.pet;
    var owner = h("input", { type: "text", value: p.ownerName || "", maxlength: "20" });
    var pet = h("input", { type: "text", value: p.petName || "", maxlength: "20" });
    var birth = h("input", { type: "date", value: p.birthday || "" });
    var death = h("input", { type: "date", value: p.deathDate || "" });
    var breed = h("input", { type: "text", value: p.breed || "", maxlength: "20" });

    function row(label, input) {
      return h("div", { class: "set-row" }, [
        h("span", { class: "label", text: label }),
        (function () { input.style.cssText = "max-width:150px;padding:6px 8px;background:var(--c-bg-2);border:1px solid var(--c-line);border-radius:8px;color:var(--c-text);font-size:14px;"; return input; })()
      ]);
    }

    var save = h("button", {
      class: "btn-primary btn-sm", text: "保存修改", onclick: function () {
        if (!owner.value.trim() || !pet.value.trim() || !birth.value || !death.value) {
          PM.UI.toast("主人名、宠物名、生日与离世日期都要填写哦");
          return;
        }
        if (birth.value > death.value) { PM.UI.toast("生日不应晚于离世日期"); return; }
        data.pet.ownerName = owner.value.trim();
        data.pet.petName = pet.value.trim();
        data.pet.birthday = birth.value;
        data.pet.deathDate = death.value;
        data.pet.breed = breed.value.trim();
        PM.Store.save(data);
        PM.UI.toast("已更新，碑文与首页已同步");
        onChanged && onChanged();
      }
    });

    return h("div", { class: "set-group" }, [
      h("h3", { text: "修改信息" }),
      row("主人名称", owner),
      row("宠物名字", pet),
      row("宠物生日", birth),
      row("离世日期", death),
      row("宠物品种", breed),
      h("div", { style: "margin-top:12px" }, [save])
    ]);
  }

  // ---------- 更换碑上照片 ----------
  function buildPhotoGroup() {
    var wrap = h("div", { class: "photo-grid", style: "grid-template-columns:repeat(4,1fr)" });
    var group = h("div", { class: "set-group" }, [h("h3", { text: "更换碑上照片" }), wrap]);
    var meta = data.photosMeta || [];
    if (!meta.length) {
      wrap.appendChild(h("div", { class: "empty-tip", style: "grid-column:1/-1", text: "暂无照片" }));
      return group;
    }
    meta.forEach(function (m) {
      var cell = h("div", { class: "photo-cell" });
      var img = h("img", { alt: "照片" });
      cell.appendChild(img);
      if (m.id === data.mainPhotoId) {
        cell.appendChild(h("span", { class: "badge-main", text: "碑上" }));
      }
      PM.Store.getPhotoBlob(m.id).then(function (blob) {
        if (blob) img.src = URL.createObjectURL(blob);
      });
      cell.addEventListener("click", function () {
        PM.Memorial.setMainPhoto(m.id);
        PM.UI.toast("已把这张设为碑上照片");
        onChanged && onChanged();
        PM.Settings.render(data, { onChanged: onChanged });
      });
      wrap.appendChild(cell);
    });
    return group;
  }

  // ---------- 导出备份 ----------
  function exportBackup() {
    PM.UI.toast("正在打包你的纪念馆…");
    var meta = data.photosMeta || [];
    Promise.all(meta.map(function (m) {
      return PM.Store.getPhotoBlob(m.id).then(function (blob) {
        return blob ? blobToDataURL(blob) : null;
      }).then(function (dataURL) { return { id: m.id, dataURL: dataURL }; });
    })).then(function (photos) {
      var payload = {
        app: "pet_memorial", version: 1, exportedAt: Date.now(),
        data: data,
        photos: photos.filter(function (p) { return p.dataURL; })
      };
      var blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "宠逝纪念-备份-" + PM.Date.todayStr() + ".json";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      PM.UI.toast("备份已导出，请妥善留存");
    });
  }

  // ---------- 导入恢复 ----------
  function importBackup(file) {
    var fr = new FileReader();
    fr.onload = function () {
      var payload;
      try { payload = JSON.parse(fr.result); } catch (e) { PM.UI.toast("这个文件好像不是有效的备份"); return; }
      if (!payload || payload.app !== "pet_memorial" || !payload.data) {
        PM.UI.toast("这个文件好像不是有效的备份"); return;
      }
      PM.UI.confirm("导入将覆盖当前的纪念馆，确定继续吗？", function (ok) {
        if (!ok) return;
        restore(payload);
      });
    };
    fr.readAsText(file);
  }
  function restore(payload) {
    PM.Store.clearPhotos().then(function () {
      var photos = payload.photos || [];
      var chain = Promise.resolve();
      var idMap = {};
      photos.forEach(function (p) {
        chain = chain.then(function () {
          if (!p.dataURL) return;
          return PM.Store.addPhoto(dataURLToBlob(p.dataURL)).then(function (r) { idMap[p.id] = r.id; });
        });
      });
      return chain.then(function () {
        var nd = payload.data;
        // 重映射照片 id
        if (nd.photosMeta) nd.photosMeta.forEach(function (m) { if (idMap[m.id]) m.id = idMap[m.id]; });
        if (nd.mainPhotoId && idMap[nd.mainPhotoId]) nd.mainPhotoId = idMap[nd.mainPhotoId];
        nd.state = nd.state || "BUILT";
        PM.Store.save(nd);
        PM.UI.toast("已恢复，即将重新打开纪念馆");
        setTimeout(function () { location.reload(); }, 800);
      });
    });
  }

  // ---------- 重建 ----------
  function rebuild() {
    var petName = data.pet.petName || "";
    PM.UI.prompt('这将清空全部数据、无法恢复。请输入它的名字「' + petName + '」以确认：', function (val) {
      if (val === null) return; // 取消
      if (val.trim() !== petName) { PM.UI.toast("名字没有对上，已为你保留数据"); return; }
      PM.Store.clearAll().then(function () {
        PM.UI.toast("已重新开始，愿下一段相伴更久");
        setTimeout(function () { location.reload(); }, 800);
      });
    });
  }

  // ---------- 空间占用 ----------
  function buildSpaceGroup() {
    var fill = h("div", { class: "space-fill", style: "width:0%" });
    var bar = h("div", { class: "space-bar" }, [fill]);
    var val = h("span", { class: "val", text: "计算中…" });
    var group = h("div", { class: "set-group" }, [
      h("h3", { text: "存储占用" }),
      h("div", { class: "set-row" }, [h("span", { class: "label", text: "本机已用" }), val]),
      bar
    ]);
    PM.Store.estimateUsage().then(function (e) {
      var usedMB = (e.usage / 1048576).toFixed(2);
      val.textContent = usedMB + " MB" + (e.quota ? " / " + (e.quota / 1048576).toFixed(0) + " MB" : "");
      var pct = e.quota ? Math.min(100, (e.usage / e.quota) * 100) : 5;
      fill.style.width = Math.max(2, pct) + "%";
    });
    return group;
  }

  // ---------- 隐私说明 ----------
  function buildAboutGroup() {
    return h("div", { class: "set-group" }, [
      h("h3", { text: "关于与隐私" }),
      h("p", { class: "val", style: "line-height:1.8", html:
        "所有文字与照片都只保存在这台设备的浏览器里，不上传、不联网。" +
        "清除浏览器数据会导致纪念馆丢失，建议定期导出备份留存。" })
    ]);
  }

  function render(d, opts) {
    data = d;
    onChanged = (opts && opts.onChanged) || null;
    var body = document.getElementById("settings-body");
    body.innerHTML = "";

    body.appendChild(buildEditGroup());
    body.appendChild(buildPhotoGroup());

    // 数据操作
    var importInput = h("input", { type: "file", accept: "application/json,.json" });
    importInput.hidden = true;
    importInput.addEventListener("change", function (e) {
      if (e.target.files && e.target.files[0]) importBackup(e.target.files[0]);
      e.target.value = "";
    });
    var ops = h("div", { class: "set-group" }, [
      h("h3", { text: "数据管理" }),
      h("div", { class: "set-actions" }, [
        h("button", { class: "btn-primary btn-sm", text: "导出备份", onclick: exportBackup }),
        h("button", { class: "btn-ghost", text: "导入恢复", onclick: function () { importInput.click(); } }),
        importInput,
        h("button", { class: "btn-ghost btn-danger", text: "重建纪念馆", onclick: rebuild })
      ])
    ]);
    body.appendChild(ops);
    body.appendChild(buildSpaceGroup());
    body.appendChild(buildAboutGroup());
  }

  return { render: render };
})();
