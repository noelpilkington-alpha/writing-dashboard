(function () {
  "use strict";

  let DATA = null;
  let activeFilters = { campus: "all", level: "all", status: "all", search: "" };

  // ── Boot ──────────────────────────────────────────────────────────────
  async function init() {
    try {
      const resp = await fetch("data.json");
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      DATA = await resp.json();
      renderMeta();
      populateDropdowns();
      renderStudents();
      wireEvents();
      handleRoute();
    } catch (e) {
      document.getElementById("loading").textContent =
        "Failed to load data.json: " + e.message;
    }
  }

  // ── Routing ─────────────────────────────────────────────────────────
  function handleRoute() {
    const hash = location.hash.replace("#", "") || "students";
    showPage(hash === "metrics" ? "metrics" : "students");
  }

  function showPage(page) {
    document.querySelectorAll(".page").forEach((p) => p.classList.add("hidden"));
    document.getElementById("page-" + page).classList.remove("hidden");
    document.querySelectorAll(".nav-link").forEach((a) => {
      a.classList.toggle("active", a.dataset.page === page);
    });
    if (page === "metrics") renderMetrics();
  }

  // ── Meta ─────────────────────────────────────────────────────────────
  function renderMeta() {
    const s = DATA.session;
    const gen = new Date(DATA.generated_at).toLocaleString();
    document.getElementById("header-meta").textContent =
      `Session ${s.name} | Day ${s.school_days_elapsed} | Updated: ${gen}`;
  }

  // ── Dropdowns ───────────────────────────────────────────────────────
  function populateDropdowns() {
    const campuses = [...new Set(DATA.students.map((s) => s.campus).filter(Boolean))].sort();
    const levels = [...new Set(DATA.students.map((s) => s.level).filter(Boolean))].sort();

    const campusEl = document.getElementById("campus-select");
    campuses.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c;
      campusEl.appendChild(opt);
    });

    const levelEl = document.getElementById("level-select");
    levels.forEach((l) => {
      const opt = document.createElement("option");
      opt.value = l;
      opt.textContent = l;
      levelEl.appendChild(opt);
    });
  }

  // ── Events ──────────────────────────────────────────────────────────
  function wireEvents() {
    // Dropdowns
    document.getElementById("campus-select").addEventListener("change", (e) => {
      activeFilters.campus = e.target.value;
      applyFilters();
    });
    document.getElementById("level-select").addEventListener("change", (e) => {
      activeFilters.level = e.target.value;
      applyFilters();
    });
    document.getElementById("status-select").addEventListener("change", (e) => {
      activeFilters.status = e.target.value;
      applyFilters();
    });

    // Search
    let timer;
    document.getElementById("search").addEventListener("input", (e) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        activeFilters.search = e.target.value.toLowerCase().trim();
        applyFilters();
      }, 200);
    });

    // Card expand/collapse
    document.getElementById("main").addEventListener("click", (e) => {
      const summary = e.target.closest(".card-summary");
      if (!summary) return;
      summary.closest(".student-card").classList.toggle("expanded");
    });

    // Nav links
    document.querySelectorAll(".nav-link").forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        const page = link.dataset.page;
        location.hash = page === "students" ? "" : page;
        showPage(page);
      });
    });

    document.querySelector(".logo-link").addEventListener("click", (e) => {
      e.preventDefault();
      location.hash = "";
      showPage("students");
    });

    window.addEventListener("hashchange", handleRoute);
  }

  // ── Filters ─────────────────────────────────────────────────────────
  function applyFilters() {
    const cards = document.querySelectorAll(".student-card");
    const groups = document.querySelectorAll(".group-header");
    let visibleCount = 0;

    cards.forEach((card) => {
      const d = JSON.parse(card.dataset.student);
      let show = true;

      if (activeFilters.campus !== "all" && d.campus !== activeFilters.campus) show = false;
      if (activeFilters.level !== "all" && d.level !== activeFilters.level) show = false;
      if (activeFilters.status === "issues" && d.insights.length === 0) show = false;
      if (activeFilters.status === "on-track" && d.insights.length > 0) show = false;
      if (activeFilters.search) {
        const q = activeFilters.search;
        if (!d.name.toLowerCase().includes(q) && !d.email.toLowerCase().includes(q)) show = false;
      }

      card.classList.toggle("hidden", !show);
      if (show) visibleCount++;
    });

    // Show/hide group headers
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

    const total = DATA.students.length;
    document.getElementById("results-count").textContent =
      visibleCount === total ? `${total} students` : `${visibleCount} of ${total} students`;
  }

  // ── Student cards ───────────────────────────────────────────────────
  function renderStudents() {
    const main = document.getElementById("main");
    main.innerHTML = "";

    const grouped = {};
    DATA.students.forEach((s) => {
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

      const students = grouped[key].sort((a, b) => a.name.localeCompare(b.name));
      for (const s of students) {
        main.appendChild(buildCard(s));
      }
    }

    document.getElementById("results-count").textContent = `${DATA.students.length} students`;
  }

  function buildCard(s) {
    const card = document.createElement("div");
    card.className = "student-card";
    card.dataset.student = JSON.stringify(s);

    const severity = s.insights.length === 0 ? "none"
      : s.insights.some((i) => i.severity === "high") ? "high"
      : s.insights.some((i) => i.severity === "medium") ? "medium" : "low";

    const xpPct = s.xp.goal_to_date > 0 ? Math.min(100, Math.round((s.xp.total / s.xp.goal_to_date) * 100)) : 0;
    const xpColor = s.xp.meets_goal ? "green" : xpPct >= 70 ? "orange" : "red";

    const minPct = s.minutes.goal_to_date > 0 ? Math.min(100, Math.round((s.minutes.total / s.minutes.goal_to_date) * 100)) : 0;
    const minColor = s.minutes.meets_goal ? "green" : minPct >= 70 ? "orange" : "red";

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
          <span class="metric">
            Time: ${Math.round(s.minutes.total)}/${Math.round(s.minutes.goal_to_date)} min (${minPct}%)
            <span class="metric-bar"><span class="metric-fill ${minColor}" style="width:${minPct}%"></span></span>
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
  function renderMetrics() {
    const container = document.getElementById("metrics-container");
    const students = DATA.students;
    const total = students.length;
    const xpOk = students.filter((s) => s.xp.meets_goal).length;
    const timeOk = students.filter((s) => s.minutes.meets_goal).length;
    const bothOk = students.filter((s) => s.xp.meets_goal && s.minutes.meets_goal).length;
    const dd = students.filter((s) => s.deep_dive.needed).length;
    const accFlags = students.filter((s) => s.accuracy.activities_below_threshold.length > 0).length;
    const noTests = students.filter((s) => !s.last_test).length;
    const xpPct = total > 0 ? Math.round((xpOk / total) * 100) : 0;
    const timePct = total > 0 ? Math.round((timeOk / total) * 100) : 0;
    const bothPct = total > 0 ? Math.round((bothOk / total) * 100) : 0;

    // Campus breakdown
    const campusMap = {};
    students.forEach((s) => {
      const c = s.campus || "Unknown";
      if (!campusMap[c]) campusMap[c] = { total: 0, xpOk: 0, timeOk: 0, dd: 0, accFlags: 0 };
      campusMap[c].total++;
      if (s.xp.meets_goal) campusMap[c].xpOk++;
      if (s.minutes.meets_goal) campusMap[c].timeOk++;
      if (s.deep_dive.needed) campusMap[c].dd++;
      if (s.accuracy.activities_below_threshold.length > 0) campusMap[c].accFlags++;
    });

    // Level breakdown
    const levelMap = {};
    students.forEach((s) => {
      const l = s.level || "Unknown";
      if (!levelMap[l]) levelMap[l] = { total: 0, xpOk: 0, timeOk: 0, dd: 0 };
      levelMap[l].total++;
      if (s.xp.meets_goal) levelMap[l].xpOk++;
      if (s.minutes.meets_goal) levelMap[l].timeOk++;
      if (s.deep_dive.needed) levelMap[l].dd++;
    });

    let html = `
      <div class="metrics-grid">
        <div class="metric-card">
          <div class="metric-value blue">${total}</div>
          <div class="metric-label">Total Students</div>
        </div>
        <div class="metric-card">
          <div class="metric-value green">${xpOk}</div>
          <div class="metric-label">XP On Track</div>
          <div class="metric-sub">${xpPct}% of students</div>
        </div>
        <div class="metric-card">
          <div class="metric-value green">${timeOk}</div>
          <div class="metric-label">Time On Track</div>
          <div class="metric-sub">${timePct}% of students</div>
        </div>
        <div class="metric-card">
          <div class="metric-value green">${bothOk}</div>
          <div class="metric-label">Both Goals Met</div>
          <div class="metric-sub">${bothPct}% of students</div>
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
          <div class="metric-sub">Goals: ${DATA.thresholds.xp_per_day} XP/day, ${DATA.thresholds.minutes_per_day} min/day</div>
        </div>
      </div>
    `;

    // Campus breakdown table
    html += `<div class="metrics-section"><h2>By Campus</h2>
      <table class="metrics-table">
        <tr><th>Campus</th><th>Students</th><th>XP On Track</th><th>Time On Track</th><th>Deep Dives</th><th>Accuracy Flags</th></tr>`;
    for (const c of Object.keys(campusMap).sort()) {
      const d = campusMap[c];
      const xpPctC = d.total > 0 ? Math.round((d.xpOk / d.total) * 100) : 0;
      const timePctC = d.total > 0 ? Math.round((d.timeOk / d.total) * 100) : 0;
      html += `<tr>
        <td>${esc(c)}</td>
        <td>${d.total}</td>
        <td><div class="bar-cell">${d.xpOk} (${xpPctC}%) <div class="bar-bg"><div class="bar-fill ${xpPctC >= 70 ? "green" : xpPctC >= 40 ? "orange" : "red"}" style="width:${xpPctC}%"></div></div></div></td>
        <td><div class="bar-cell">${d.timeOk} (${timePctC}%) <div class="bar-bg"><div class="bar-fill ${timePctC >= 70 ? "green" : timePctC >= 40 ? "orange" : "red"}" style="width:${timePctC}%"></div></div></div></td>
        <td>${d.dd > 0 ? '<span class="score-fail">' + d.dd + '</span>' : '0'}</td>
        <td>${d.accFlags > 0 ? '<span class="score-fail">' + d.accFlags + '</span>' : '0'}</td>
      </tr>`;
    }
    html += `</table></div>`;

    // Level breakdown table
    html += `<div class="metrics-section"><h2>By Level</h2>
      <table class="metrics-table">
        <tr><th>Level</th><th>Students</th><th>XP On Track</th><th>Time On Track</th><th>Deep Dives</th></tr>`;
    for (const l of Object.keys(levelMap).sort()) {
      const d = levelMap[l];
      const xpPctL = d.total > 0 ? Math.round((d.xpOk / d.total) * 100) : 0;
      const timePctL = d.total > 0 ? Math.round((d.timeOk / d.total) * 100) : 0;
      html += `<tr>
        <td>${esc(l)}</td>
        <td>${d.total}</td>
        <td><div class="bar-cell">${d.xpOk} (${xpPctL}%) <div class="bar-bg"><div class="bar-fill ${xpPctL >= 70 ? "green" : xpPctL >= 40 ? "orange" : "red"}" style="width:${xpPctL}%"></div></div></div></td>
        <td><div class="bar-cell">${d.timeOk} (${timePctL}%) <div class="bar-bg"><div class="bar-fill ${timePctL >= 70 ? "green" : timePctL >= 40 ? "orange" : "red"}" style="width:${timePctL}%"></div></div></div></td>
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
