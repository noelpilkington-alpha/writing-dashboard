(function () {
  "use strict";

  let DATA = null;
  const filters = {
    timeback: { campus: "all", level: "all", status: "all", search: "" },
  };

  // ── Boot ──────────────────────────────────────────────────────────────
  async function init() {
    try {
      const resp = await fetch("data.json");
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      DATA = await resp.json();
      renderMeta();
      setupGroup("timeback");
      wireNav();
      handleRoute();
    } catch (e) {
      document.getElementById("loading").textContent =
        "Failed to load data.json: " + e.message;
    }
  }

  function studentsForGroup(group) {
    return DATA.students.filter((s) => s.dashboard === "timeback");
  }

  // ── Routing ─────────────────────────────────────────────────────────
  const PAGES = ["timeback", "timeback-metrics"];

  function handleRoute() {
    const hash = location.hash.replace("#", "") || "timeback";
    showPage(PAGES.includes(hash) ? hash : "timeback");
  }

  function showPage(page) {
    document.querySelectorAll(".page").forEach((p) => p.classList.add("hidden"));
    document.getElementById("page-" + page).classList.remove("hidden");
    document.querySelectorAll(".nav-link").forEach((a) => {
      a.classList.toggle("active", a.dataset.page === page);
    });
    if (page === "timeback-metrics") renderMetrics("timeback");
  }

  function wireNav() {
    document.querySelectorAll(".nav-link").forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        const page = link.dataset.page;
        location.hash = page;
        showPage(page);
      });
    });
    document.querySelector(".logo-link").addEventListener("click", (e) => {
      e.preventDefault();
      location.hash = "timeback";
      showPage("timeback");
    });
    window.addEventListener("hashchange", handleRoute);
  }

  // ── Meta ─────────────────────────────────────────────────────────────
  function renderMeta() {
    const s = DATA.session;
    const gen = new Date(DATA.generated_at).toLocaleString();
    document.getElementById("header-meta").textContent =
      `Session ${s.name} | Day ${s.school_days_elapsed} | Updated: ${gen}`;
  }

  // ── Setup a group (timeback or legacy) ──────────────────────────────
  function setupGroup(group) {
    const students = studentsForGroup(group);
    populateDropdowns(group, students);
    renderStudents(group, students);
    wireGroupEvents(group);
  }

  function populateDropdowns(group, students) {
    const campuses = [...new Set(students.map((s) => s.campus).filter(Boolean))].sort();
    const levels = [...new Set(students.map((s) => s.level).filter(Boolean))].sort();

    const campusEl = document.getElementById("campus-" + group);
    campusEl.innerHTML = '<option value="all">All Campuses</option>';
    campuses.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c;
      campusEl.appendChild(opt);
    });

    const levelEl = document.getElementById("level-" + group);
    levelEl.innerHTML = '<option value="all">All Levels</option>';
    levels.forEach((l) => {
      const opt = document.createElement("option");
      opt.value = l;
      opt.textContent = l;
      levelEl.appendChild(opt);
    });
  }

  function wireGroupEvents(group) {
    const f = filters[group];

    document.getElementById("campus-" + group).addEventListener("change", (e) => {
      f.campus = e.target.value;
      applyFilters(group);
    });
    document.getElementById("level-" + group).addEventListener("change", (e) => {
      f.level = e.target.value;
      applyFilters(group);
    });
    document.getElementById("status-" + group).addEventListener("change", (e) => {
      f.status = e.target.value;
      applyFilters(group);
    });

    let timer;
    document.getElementById("search-" + group).addEventListener("input", (e) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        f.search = e.target.value.toLowerCase().trim();
        applyFilters(group);
      }, 200);
    });

    document.getElementById("main-" + group).addEventListener("click", (e) => {
      const summary = e.target.closest(".card-summary");
      if (!summary) return;
      summary.closest(".student-card").classList.toggle("expanded");
    });
  }

  // ── Filters ─────────────────────────────────────────────────────────
  function applyFilters(group) {
    const f = filters[group];
    const main = document.getElementById("main-" + group);
    const cards = main.querySelectorAll(".student-card");
    const groups = main.querySelectorAll(".group-header");
    let visibleCount = 0;
    const total = studentsForGroup(group).length;

    cards.forEach((card) => {
      const d = JSON.parse(card.dataset.student);
      let show = true;

      if (f.campus !== "all" && d.campus !== f.campus) show = false;
      if (f.level !== "all" && d.level !== f.level) show = false;
      if (f.status === "issues" && d.insights.length === 0) show = false;
      if (f.status === "on-track" && d.insights.length > 0) show = false;
      if (f.search) {
        const q = f.search;
        if (!d.name.toLowerCase().includes(q) && !d.email.toLowerCase().includes(q)) show = false;
      }

      card.classList.toggle("hidden", !show);
      if (show) visibleCount++;
    });

    groups.forEach((gh) => {
      let next = gh.nextElementSibling;
      let hasVisible = false;
      while (next && !next.classList.contains("group-header")) {
        if (next.classList.contains("student-card") && !next.classList.contains("hidden")) {
          hasVisible = true;
          break;
        }
        next = next.nextElementSibling;
      }
      gh.classList.toggle("hidden", !hasVisible);
    });

    document.getElementById("results-count-" + group).textContent =
      visibleCount === total ? `${total} students` : `${visibleCount} of ${total} students`;
  }

  // ── Student cards ───────────────────────────────────────────────────
  function renderStudents(group, students) {
    const main = document.getElementById("main-" + group);
    main.innerHTML = "";

    const grouped = {};
    students.forEach((s) => {
      const key = `${s.campus || "Unknown Campus"}|||${s.level || "Unknown Level"}`;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(s);
    });

    const sortedKeys = Object.keys(grouped).sort();
    if (sortedKeys.length === 0) {
      main.innerHTML = '<div class="loading">No students found.</div>';
      return;
    }

    for (const key of sortedKeys) {
      const [campus, level] = key.split("|||");
      const header = document.createElement("div");
      header.className = "group-header";
      header.textContent = `${campus} — ${level}`;
      main.appendChild(header);

      const list = grouped[key].sort((a, b) => a.name.localeCompare(b.name));
      for (const s of list) {
        main.appendChild(buildCard(s));
      }
    }

    document.getElementById("results-count-" + group).textContent = `${students.length} students`;
  }

  function buildCard(s) {
    const card = document.createElement("div");
    card.className = "student-card";
    card.dataset.student = JSON.stringify(s);

    // G8 completers get a special display
    if (s.completed_g8) {
      let lastTestHtml = "";
      if (s.last_test) {
        lastTestHtml = `Last Test: ${esc(s.last_test.name)} (${s.last_test.score}%, ${formatDate(s.last_test.date)})`;
      }
      card.innerHTML = `
        <div class="card-summary">
          <div class="card-row1">
            <span class="student-name">${esc(s.name)}</span>
            <span class="student-email">${esc(s.email)}</span>
            <span class="student-grade">G${s.age_grade}</span>
            <span class="student-hmg">HMG: G${s.hmg}</span>
          </div>
          <span class="expand-icon">&#9660;</span>
          <div class="card-row2">
            <span class="insights-badge none">Completed G8 Writing</span>
            ${lastTestHtml ? `<span class="last-test">${lastTestHtml}</span>` : ""}
          </div>
        </div>
        <div class="card-detail">
          ${buildDetail(s)}
        </div>
      `;
      return card;
    }

    const severity = s.insights.length === 0 ? "none"
      : s.insights.some((i) => i.severity === "high") ? "high"
      : s.insights.some((i) => i.severity === "medium") ? "medium" : "low";

    const xpPct = s.xp.goal_to_date > 0 ? Math.min(100, Math.round((s.xp.total / s.xp.goal_to_date) * 100)) : 0;
    const xpColor = s.xp.meets_goal ? "green" : xpPct >= 70 ? "orange" : "red";

    let lastTestHtml = '<span class="no-data">No tests</span>';
    if (s.last_test) {
      const cls = s.last_test.passed ? "passed" : "failed";
      const label = s.last_test.passed ? "PASSED" : "FAILED";
      lastTestHtml = `${esc(s.last_test.name)} (${s.last_test.score}%, ${formatDate(s.last_test.date)}) <span class="${cls}">${label}</span>`;
    }

    card.innerHTML = `
      <div class="card-summary">
        <div class="card-row1">
          <span class="student-name">${esc(s.name)}</span>
          <span class="student-email">${esc(s.email)}</span>
          <span class="student-grade">G${s.age_grade}</span>
          <span class="student-hmg">HMG: G${s.hmg}</span>
        </div>
        <span class="expand-icon">&#9660;</span>
        <div class="card-row2">
          <span class="enrollment-text">Enrolled: ${s.enrollments.length ? esc(s.enrollments.join(", ")) : '<span class="no-data">None</span>'}</span>
          <span class="last-test">Last Test: ${lastTestHtml}</span>
        </div>
        <div class="card-row3">
          <span class="metric">
            XP: ${Math.round(s.xp.total)}/${Math.round(s.xp.goal_to_date)} (${xpPct}%)
            <span class="metric-bar"><span class="metric-fill ${xpColor}" style="width:${xpPct}%"></span></span>
          </span>
          ${s.insights.length > 0
            ? `<span class="insights-badge ${severity}">${s.insights.length} insight${s.insights.length > 1 ? "s" : ""}</span>`
            : `<span class="insights-badge none">On Track</span>`
          }
        </div>
      </div>
      <div class="card-detail">
        ${buildDetail(s)}
      </div>
    `;

    return card;
  }

  // ── Detail sections ─────────────────────────────────────────────────
  function buildDetail(s) {
    let html = "";

    if (s.insights.length > 0) {
      html += `<div class="detail-section"><h4>Insights</h4>`;
      for (const ins of s.insights) {
        html += `<div class="insight-item"><span class="insight-dot ${ins.severity}"></span>${esc(ins.text)}</div>`;
      }
      html += `</div>`;
    }

    if (s.next_expected_test) {
      const cls = s.next_expected_test.status === "retaking" ? "next-test-retaking" : "next-test-pending";
      html += `<div class="detail-section"><h4>Next Expected Test</h4>
        <span class="${cls}">${esc(s.next_expected_test.name)} - ${esc(s.next_expected_test.status)} (${esc(s.next_expected_test.reason)})</span>
      </div>`;
    }

    if (s.session_tests.length > 0) {
      html += `<div class="detail-section"><h4>Session Tests</h4>
        <table class="detail-table">
          <tr><th>Test</th><th>Type</th><th>Score</th><th>Date</th><th>Time</th><th></th></tr>`;
      for (const t of s.session_tests) {
        const cls = t.passed ? "score-pass" : "score-fail";
        const timeMin = t.time_seconds ? Math.round(t.time_seconds / 60) + " min" : "-";
        const rushed = t.rushed ? '<span class="rushed-tag">RUSHED</span>' : "";
        html += `<tr>
          <td>${esc(t.name)}</td><td>${esc(t.type)}</td>
          <td class="${cls}">${t.score}%</td><td>${formatDate(t.date)}</td>
          <td>${timeMin}</td><td>${rushed}</td>
        </tr>`;
      }
      html += `</table></div>`;
    }

    // XP Breakdown: Test XP
    if (s.xp_details && s.xp_details.test_xp && s.xp_details.test_xp.length > 0) {
      html += `<div class="detail-section"><h4>Test XP</h4>
        <table class="detail-table">
          <tr><th>Test</th><th>Score</th><th>XP</th><th>Date</th></tr>`;
      for (const t of s.xp_details.test_xp) {
        html += `<tr>
          <td>${esc(t.name)}</td>
          <td>${t.score != null ? t.score + "%" : "-"}</td>
          <td>${t.xp}</td>
          <td>${formatDate(t.date)}</td>
        </tr>`;
      }
      html += `</table></div>`;
    }

    // XP Breakdown: Activity XP
    if (s.xp_details && s.xp_details.activity_xp && s.xp_details.activity_xp.length > 0) {
      html += `<div class="detail-section"><h4>Activity XP</h4>
        <table class="detail-table">
          <tr><th>Activity</th><th>Course</th><th>XP</th><th>Type</th><th>Date</th></tr>`;
      for (const a of s.xp_details.activity_xp) {
        const typeLabel = a.type === "alphawrite" ? "AlphaWrite"
          : a.type === "external" ? "External"
          : "Mastery Track";
        html += `<tr>
          <td>${esc(a.name)}</td><td>${esc(a.course)}</td>
          <td>${a.xp}</td><td>${typeLabel}</td>
          <td>${formatDate(a.date)}</td>
        </tr>`;
      }
      html += `</table></div>`;
    }

    if (s.accuracy.activities_below_threshold.length > 0) {
      html += `<div class="detail-section"><h4>Low Accuracy AlphaWrite Activities (&lt;${DATA.thresholds.accuracy_pct}%)</h4>
        <table class="detail-table">
          <tr><th>Activity</th><th>Course</th><th>Accuracy</th><th>Questions</th><th>XP</th><th>Date</th></tr>`;
      for (const a of s.accuracy.activities_below_threshold) {
        html += `<tr>
          <td>${esc(a.name)}</td><td>${esc(a.course)}</td>
          <td class="score-fail">${a.accuracy}%</td><td>${esc(a.questions)}</td>
          <td>${a.xp}</td><td>${formatDate(a.date)}</td>
        </tr>`;
      }
      html += `</table></div>`;
    }

    if (s.accuracy.repeated_activities.length > 0) {
      html += `<div class="detail-section"><h4>Repeated AlphaWrite Activities</h4>
        <table class="detail-table">
          <tr><th>Activity</th><th>Course</th><th>Attempts</th><th>Best</th><th>Latest</th></tr>`;
      for (const a of s.accuracy.repeated_activities) {
        html += `<tr>
          <td>${esc(a.name)}</td><td>${esc(a.course)}</td>
          <td>${a.attempts}</td><td>${a.best_accuracy != null ? a.best_accuracy + "%" : "-"}</td>
          <td>${a.latest_accuracy != null ? a.latest_accuracy + "%" : "-"}</td>
        </tr>`;
      }
      html += `</table></div>`;
    }

    if (s.deep_dive.needed && s.deep_dive.details.length > 0) {
      for (const d of s.deep_dive.details) {
        html += `<div class="detail-section"><h4>Deep Dive: G${d.grade}</h4>
          <div style="font-size:0.85rem;margin-bottom:8px">
            ${d.failed_count} failed / ${d.rushed_count} rushed / avg ${d.avg_time_minutes} min
          </div>
          <table class="detail-table">
            <tr><th>Test</th><th>Score</th><th>Date</th><th></th></tr>`;
        for (const t of d.tests) {
          const cls = t.score >= DATA.thresholds.pass_score ? "score-pass" : "score-fail";
          const rushed = t.rushed ? '<span class="rushed-tag">RUSHED</span>' : "";
          html += `<tr><td>${esc(t.name)}</td><td class="${cls}">${t.score}%</td><td>${formatDate(t.date)}</td><td>${rushed}</td></tr>`;
        }
        html += `</table></div>`;
      }
    }

    if (s.enrollment_mismatch) {
      html += `<div class="detail-section"><h4>Enrollment Mismatch</h4>
        <div class="mismatch-warning">${esc(s.enrollment_mismatch)}</div>
      </div>`;
    }

    if (!html) {
      html = '<div class="no-data" style="padding:8px 0">No additional details.</div>';
    }

    return html;
  }

  // ── Metrics Page ────────────────────────────────────────────────────
  function renderMetrics(group) {
    const container = document.getElementById("metrics-" + group);
    const students = studentsForGroup(group);
    const total = students.length;
    const g8Done = students.filter((s) => s.completed_g8).length;
    const active = students.filter((s) => !s.completed_g8);
    const activeCount = active.length;
    const xpOk = active.filter((s) => s.xp.meets_goal).length;
    const dd = active.filter((s) => s.deep_dive.needed).length;
    const accFlags = active.filter((s) => s.accuracy.activities_below_threshold.length > 0).length;
    const noTests = students.filter((s) => !s.last_test).length;
    const xpPct = activeCount > 0 ? Math.round((xpOk / activeCount) * 100) : 0;
    const label = group === "legacy" ? "Legacy Dash" : "Timeback";

    const campusMap = {};
    students.forEach((s) => {
      const c = s.campus || "Unknown";
      if (!campusMap[c]) campusMap[c] = { total: 0, g8: 0, xpOk: 0, dd: 0, accFlags: 0 };
      campusMap[c].total++;
      if (s.completed_g8) { campusMap[c].g8++; return; }
      if (s.xp.meets_goal) campusMap[c].xpOk++;
      if (s.deep_dive.needed) campusMap[c].dd++;
      if (s.accuracy.activities_below_threshold.length > 0) campusMap[c].accFlags++;
    });

    const levelMap = {};
    students.forEach((s) => {
      const l = s.level || "Unknown";
      if (!levelMap[l]) levelMap[l] = { total: 0, g8: 0, xpOk: 0, dd: 0 };
      levelMap[l].total++;
      if (s.completed_g8) { levelMap[l].g8++; return; }
      if (s.xp.meets_goal) levelMap[l].xpOk++;
      if (s.deep_dive.needed) levelMap[l].dd++;
    });

    let html = `<h2 style="margin-bottom:16px">${esc(label)} Metrics</h2>
      <div class="metrics-grid">
        <div class="metric-card">
          <div class="metric-value blue">${total}</div>
          <div class="metric-label">Total Students</div>
        </div>
        <div class="metric-card">
          <div class="metric-value green">${g8Done}</div>
          <div class="metric-label">Completed G8 Writing</div>
        </div>
        <div class="metric-card">
          <div class="metric-value green">${xpOk}</div>
          <div class="metric-label">XP On Track</div>
          <div class="metric-sub">${xpPct}% of ${activeCount} active</div>
        </div>
        <div class="metric-card">
          <div class="metric-value red">${dd}</div>
          <div class="metric-label">Deep Dives Needed</div>
        </div>
        <div class="metric-card">
          <div class="metric-value orange">${accFlags}</div>
          <div class="metric-label">Accuracy Flags</div>
          <div class="metric-sub">AlphaWrite &lt;${DATA.thresholds.accuracy_pct}%</div>
        </div>
        <div class="metric-card">
          <div class="metric-value">${noTests}</div>
          <div class="metric-label">No Tests Taken</div>
        </div>
        <div class="metric-card">
          <div class="metric-value">${DATA.session.school_days_elapsed}</div>
          <div class="metric-label">School Days Elapsed</div>
          <div class="metric-sub">Goal: ${DATA.thresholds.xp_per_day} XP/day</div>
        </div>
      </div>
    `;

    html += `<div class="metrics-section"><h2>By Campus</h2>
      <table class="metrics-table">
        <tr><th>Campus</th><th>Students</th><th>G8 Done</th><th>XP On Track</th><th>Deep Dives</th><th>Accuracy Flags</th></tr>`;
    for (const c of Object.keys(campusMap).sort()) {
      const d = campusMap[c];
      const activeC = d.total - d.g8;
      const xpPctC = activeC > 0 ? Math.round((d.xpOk / activeC) * 100) : 0;
      html += `<tr>
        <td>${esc(c)}</td>
        <td>${d.total}</td>
        <td>${d.g8}</td>
        <td><div class="bar-cell">${d.xpOk}/${activeC} (${xpPctC}%) <div class="bar-bg"><div class="bar-fill ${xpPctC >= 70 ? "green" : xpPctC >= 40 ? "orange" : "red"}" style="width:${xpPctC}%"></div></div></div></td>
        <td>${d.dd > 0 ? '<span class="score-fail">' + d.dd + '</span>' : '0'}</td>
        <td>${d.accFlags > 0 ? '<span class="score-fail">' + d.accFlags + '</span>' : '0'}</td>
      </tr>`;
    }
    html += `</table></div>`;

    html += `<div class="metrics-section"><h2>By Level</h2>
      <table class="metrics-table">
        <tr><th>Level</th><th>Students</th><th>G8 Done</th><th>XP On Track</th><th>Deep Dives</th></tr>`;
    for (const l of Object.keys(levelMap).sort()) {
      const d = levelMap[l];
      const activeL = d.total - d.g8;
      const xpPctL = activeL > 0 ? Math.round((d.xpOk / activeL) * 100) : 0;
      html += `<tr>
        <td>${esc(l)}</td>
        <td>${d.total}</td>
        <td>${d.g8}</td>
        <td><div class="bar-cell">${d.xpOk}/${activeL} (${xpPctL}%) <div class="bar-bg"><div class="bar-fill ${xpPctL >= 70 ? "green" : xpPctL >= 40 ? "orange" : "red"}" style="width:${xpPctL}%"></div></div></div></td>
        <td>${d.dd > 0 ? '<span class="score-fail">' + d.dd + '</span>' : '0'}</td>
      </tr>`;
    }
    html += `</table></div>`;

    container.innerHTML = html;
  }

  // ── Helpers ──────────────────────────────────────────────────────────
  function esc(str) {
    if (str == null) return "";
    const d = document.createElement("div");
    d.textContent = String(str);
    return d.innerHTML;
  }

  function formatDate(dateStr) {
    if (!dateStr) return "-";
    const parts = dateStr.split("-");
    if (parts.length === 3) return `${parts[1]}/${parts[2]}`;
    return dateStr;
  }

  // ── Start ───────────────────────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", init);
})();
