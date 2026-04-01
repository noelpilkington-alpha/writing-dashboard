(function () {
  "use strict";

  let DATA = null;
  let LOOP_DATA = null;
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
  const PAGES = ["timeback", "timeback-metrics", "eg-analysis", "test-results", "test-analysis", "testing-loops"];

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
    if (page === "eg-analysis") renderEGAnalysis();
    if (page === "test-results") renderTestResults();
    if (page === "test-analysis") renderTestAnalysis();
    if (page === "testing-loops") renderTestingLoops();
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

  // ── Setup a group ────────────────────────────────────────────────────
  function setupGroup(group) {
    const students = studentsForGroup(group);
    populateDropdowns(group, students);
    renderCampusView(group, students);
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
      // Campus dropdown toggle
      const campusHeader = e.target.closest(".campus-header");
      if (campusHeader) {
        const section = campusHeader.closest(".campus-section");
        section.classList.toggle("collapsed");
        return;
      }
      // Student card toggle
      const summary = e.target.closest(".card-summary");
      if (!summary) return;
      summary.closest(".student-card").classList.toggle("expanded");
    });

    // Deep Dive button
    wireDeepDiveButton(group);
  }

  // ── Deep Dive panel ──────────────────────────────────────────────────
  function classifyDeepDiveStudents(students) {
    const results = [];
    for (const s of students) {
      if (s.completed_g8) continue;
      const reasons = [];
      if (s.deep_dive && s.deep_dive.needed) {
        reasons.push({ type: "testing-loop", label: "Testing Loop" });
      }
      if (!s.xp.meets_goal) {
        reasons.push({ type: "xp-behind", label: "XP Behind" });
      }
      if (s.accuracy && s.accuracy.activities_below_threshold.length >= 3) {
        reasons.push({ type: "low-accuracy", label: `${s.accuracy.activities_below_threshold.length} Low Accuracy` });
      }
      if (reasons.length > 0) {
        results.push({ student: s, reasons });
      }
    }
    return results;
  }

  function wireDeepDiveButton(group) {
    const btn = document.getElementById("deep-dive-btn");
    if (!btn) return;

    const students = studentsForGroup(group);
    const ddStudents = classifyDeepDiveStudents(students);
    btn.innerHTML = `Deep Dives <span class="dd-count">${ddStudents.length}</span>`;

    btn.addEventListener("click", () => {
      const panel = document.getElementById("deep-dive-panel");
      if (!panel.classList.contains("hidden")) {
        panel.classList.add("hidden");
        return;
      }
      renderDeepDivePanel(group, ddStudents);
    });
  }

  function renderDeepDivePanel(group, ddStudents) {
    const panel = document.getElementById("deep-dive-panel");

    // Count per criteria
    const loopCount = ddStudents.filter((d) => d.reasons.some((r) => r.type === "testing-loop")).length;
    const xpCount = ddStudents.filter((d) => d.reasons.some((r) => r.type === "xp-behind")).length;
    const accCount = ddStudents.filter((d) => d.reasons.some((r) => r.type === "low-accuracy")).length;

    let activeFilter = "all";

    function renderList(filter) {
      activeFilter = filter;
      const filtered = filter === "all"
        ? ddStudents
        : ddStudents.filter((d) => d.reasons.some((r) => r.type === filter));

      // Sort: most reasons first, then alphabetical
      filtered.sort((a, b) => b.reasons.length - a.reasons.length || a.student.name.localeCompare(b.student.name));

      let listHtml = "";
      for (const { student: s, reasons } of filtered) {
        const ddSchoolXp = s.xp.school != null ? s.xp.school : s.xp.total;
        const xpPct = s.xp.goal_to_date > 0 ? Math.round((ddSchoolXp / s.xp.goal_to_date) * 100) : 0;
        const lastTest = s.last_test
          ? `Last Test: ${esc(s.last_test.name)} (${s.last_test.score}%, ${formatDate(s.last_test.date)})`
          : "No tests";
        const lastXp = !s.xp.meets_goal && s.xp.last_xp_date
          ? ` | Last XP: ${formatDate(s.xp.last_xp_date)}`
          : !s.xp.meets_goal ? " | No XP earned" : "";

        // Build analysis HTML if available
        let analysisHtml = "";
        if (s.deep_dive && s.deep_dive.details) {
          for (const d of s.deep_dive.details) {
            if (d.analysis && d.analysis.error_analysis) {
              analysisHtml += `<div class="dd-student-analysis">
                <div class="dd-analysis-grade">G${d.grade} Analysis</div>
                <div class="dd-analysis-field"><span class="dd-analysis-label">Errors:</span> ${esc(d.analysis.error_analysis)}</div>`;
              if (d.analysis.recommended_actions) {
                analysisHtml += `<div class="dd-analysis-field"><span class="dd-analysis-label">Actions:</span> ${esc(d.analysis.recommended_actions)}</div>`;
              }
              analysisHtml += `</div>`;
            }
          }
        }

        listHtml += `
          <div class="dd-student-item">
            <div class="dd-student-name">${esc(s.name)} <span style="font-weight:400;color:var(--text-muted);font-size:0.78rem">${esc(s.email)}</span></div>
            <div class="dd-student-meta">${esc(s.campus)} | ${esc(s.level)} | G${s.age_grade} | HMG: G${s.hmg}${s.effective_grade ? ` | EG: G${s.effective_grade}` : ""} | XP: ${Math.round(ddSchoolXp)}/${Math.round(s.xp.goal_to_date)} (${xpPct}%)${lastXp}</div>
            <div class="dd-student-meta">${lastTest}</div>
            <div class="dd-student-reasons">
              ${reasons.map((r) => `<span class="dd-reason ${r.type}">${esc(r.label)}</span>`).join("")}
            </div>
            ${analysisHtml}
          </div>
        `;
      }

      const listEl = panel.querySelector(".dd-student-list");
      if (listEl) listEl.innerHTML = listHtml || '<div class="no-data">No students match this filter.</div>';

      // Update active tab
      panel.querySelectorAll(".dd-tab").forEach((tab) => {
        tab.classList.toggle("active", tab.dataset.filter === filter);
      });
    }

    panel.innerHTML = `
      <div class="dd-panel-header">
        <h3>Students Requiring Deep Dives (${ddStudents.length})</h3>
        <button class="dd-panel-close">&times;</button>
      </div>
      <div class="dd-criteria-tabs">
        <span class="dd-tab active" data-filter="all">All (${ddStudents.length})</span>
        <span class="dd-tab" data-filter="testing-loop">Testing Loops (${loopCount})</span>
        <span class="dd-tab" data-filter="xp-behind">XP Behind (${xpCount})</span>
        <span class="dd-tab" data-filter="low-accuracy">Low Accuracy (${accCount})</span>
      </div>
      <div class="dd-student-list"></div>
    `;

    panel.classList.remove("hidden");

    // Wire close
    panel.querySelector(".dd-panel-close").addEventListener("click", () => {
      panel.classList.add("hidden");
    });

    // Wire tabs
    panel.querySelectorAll(".dd-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        renderList(tab.dataset.filter);
      });
    });

    // Initial render
    renderList("all");
  }

  // ── Filters ─────────────────────────────────────────────────────────
  function applyFilters(group) {
    const f = filters[group];
    const main = document.getElementById("main-" + group);
    const cards = main.querySelectorAll(".student-card");
    const campusSections = main.querySelectorAll(".campus-section");
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

    // Update campus section visibility and metrics
    campusSections.forEach((section) => {
      const sectionCards = section.querySelectorAll(".student-card");
      let hasVisible = false;
      sectionCards.forEach((c) => {
        if (!c.classList.contains("hidden")) hasVisible = true;
      });
      section.classList.toggle("hidden", !hasVisible);

      // Update the campus header counts for visible students
      const visCards = [...sectionCards].filter((c) => !c.classList.contains("hidden"));
      const headerCount = section.querySelector(".campus-count");
      if (headerCount) {
        headerCount.textContent = `${visCards.length} student${visCards.length !== 1 ? "s" : ""}`;
      }
    });

    document.getElementById("results-count-" + group).textContent =
      visibleCount === total ? `${total} students` : `${visibleCount} of ${total} students`;
  }

  // ── Campus-based landing view ──────────────────────────────────────
  function computeCampusStats(students) {
    const map = {};
    students.forEach((s) => {
      const c = s.campus || "Unknown";
      if (!map[c]) map[c] = { students: [], total: 0, g8: 0, xpOk: 0, xpBehind: 0, dd: 0, accFlags: 0, testsPassed: 0, studentsPassingTests: 0 };
      map[c].students.push(s);
      map[c].total++;
      if (s.completed_g8) { map[c].g8++; return; }
      if (s.xp.meets_goal) map[c].xpOk++;
      else map[c].xpBehind++;
      if (s.deep_dive.needed) map[c].dd++;
      if (s.accuracy.activities_below_threshold.length > 0) map[c].accFlags++;
      const ts = s.test_summary || {};
      if (ts.total_passed > 0) {
        map[c].testsPassed += ts.total_passed;
        map[c].studentsPassingTests++;
      }
    });
    return map;
  }

  function renderCampusView(group, students) {
    const main = document.getElementById("main-" + group);
    main.innerHTML = "";

    if (students.length === 0) {
      main.innerHTML = '<div class="loading">No students found.</div>';
      return;
    }

    const campusStats = computeCampusStats(students);
    const sortedCampuses = Object.keys(campusStats).sort();

    for (const campus of sortedCampuses) {
      const stats = campusStats[campus];
      const section = document.createElement("div");
      section.className = "campus-section collapsed";

      const activeCount = stats.total - stats.g8;
      const xpPct = activeCount > 0 ? Math.round((stats.xpOk / activeCount) * 100) : 0;

      section.innerHTML = `
        <div class="campus-header">
          <div class="campus-header-left">
            <span class="campus-expand-icon">&#9654;</span>
            <span class="campus-name">${esc(campus)}</span>
            <span class="campus-count">${stats.total} student${stats.total !== 1 ? "s" : ""}</span>
          </div>
          <div class="campus-metrics">
            <span class="cm-pill green" title="G8 Completed">${stats.g8} G8</span>
            <span class="cm-pill ${xpPct >= 70 ? "green" : xpPct >= 40 ? "orange" : "red"}" title="XP On Track">${stats.xpOk}/${activeCount} XP</span>
            ${stats.dd > 0 ? `<span class="cm-pill red" title="Deep Dives">${stats.dd} DD</span>` : ""}
            ${stats.accFlags > 0 ? `<span class="cm-pill orange" title="Accuracy Flags">${stats.accFlags} Acc</span>` : ""}
          </div>
        </div>
        <div class="campus-body"></div>
      `;

      // Populate campus body with level groups and student cards
      const body = section.querySelector(".campus-body");
      const levelGroups = {};
      stats.students.sort((a, b) => a.name.localeCompare(b.name));
      stats.students.forEach((s) => {
        const l = s.level || "Unknown";
        if (!levelGroups[l]) levelGroups[l] = [];
        levelGroups[l].push(s);
      });

      for (const level of Object.keys(levelGroups).sort()) {
        const header = document.createElement("div");
        header.className = "group-header";
        header.textContent = level;
        body.appendChild(header);
        for (const s of levelGroups[level]) {
          body.appendChild(buildCard(s));
        }
      }

      main.appendChild(section);
    }

    document.getElementById("results-count-" + group).textContent = `${students.length} students`;
  }

  // ── Student cards ───────────────────────────────────────────────────
  function buildCard(s) {
    const card = document.createElement("div");
    card.className = "student-card";
    card.dataset.student = JSON.stringify({
      name: s.name, email: s.email, campus: s.campus, level: s.level,
      completed_g8: s.completed_g8, insights: s.insights,
      xp: s.xp, deep_dive: s.deep_dive, accuracy: s.accuracy,
      test_summary: s.test_summary,
    });

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
            ${s.effective_grade ? `<span class="student-eff-grade">EG: G${s.effective_grade}</span>` : ""}
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

    const schoolXp = s.xp.school != null ? s.xp.school : s.xp.total;
    const xpPct = s.xp.goal_to_date > 0 ? Math.min(100, Math.round((schoolXp / s.xp.goal_to_date) * 100)) : 0;
    const xpColor = s.xp.meets_goal ? "green" : xpPct >= 70 ? "orange" : "red";

    let lastTestHtml = '<span class="no-data">No tests</span>';
    if (s.last_test) {
      const cls = s.last_test.passed ? "passed" : "failed";
      const label = s.last_test.passed ? "PASSED" : "FAILED";
      lastTestHtml = `${esc(s.last_test.name)} (${s.last_test.score}%, ${formatDate(s.last_test.date)}) <span class="${cls}">${label}</span>`;
    }

    // Last XP date indicator for students behind
    let lastXpHtml = "";
    if (!s.xp.meets_goal && s.xp.last_xp_date) {
      lastXpHtml = `<span class="last-xp-date">Last XP: ${formatDate(s.xp.last_xp_date)}</span>`;
    } else if (!s.xp.meets_goal && !s.xp.last_xp_date) {
      lastXpHtml = `<span class="last-xp-date no-xp">No XP earned</span>`;
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
            XP: ${Math.round(schoolXp)}/${Math.round(s.xp.goal_to_date)} (${xpPct}%)${s.xp.break > 0 ? ` <span class="break-xp-note">+${Math.round(s.xp.break)} break</span>` : ""}
            <span class="metric-bar"><span class="metric-fill ${xpColor}" style="width:${xpPct}%"></span></span>
          </span>
          ${lastXpHtml}
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

    if (s.effective_grade) {
      const egm = s.effective_grades_mastered != null ? s.effective_grades_mastered : 0;
      html += `<div class="detail-section"><h4>Effective Grade</h4>
        <div style="font-size:0.85rem">
          Effective Grade: <strong>G${s.effective_grade}</strong> &middot;
          Effective Grades Mastered: <strong>${egm}</strong>
          ${egm > 0 ? `(G${s.effective_grade} through G${s.effective_grade + egm - 1})` : ""}
        </div>
      </div>`;
    }

    if (s.next_expected_test) {
      const cls = s.next_expected_test.status === "retaking" ? "next-test-retaking" : "next-test-pending";
      html += `<div class="detail-section"><h4>Next Expected Test</h4>
        <span class="${cls}">${esc(s.next_expected_test.name)} - ${esc(s.next_expected_test.status)} (${esc(s.next_expected_test.reason)})</span>
      </div>`;
    }

    if (s.session_tests && s.session_tests.length > 0) {
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

    // All-time test history
    if (s.all_tests && s.all_tests.length > 0) {
      html += `<div class="detail-section"><h4>All Writing Tests</h4>
        <table class="detail-table">
          <tr><th>Test</th><th>Type</th><th>Score</th><th>Date</th><th></th></tr>`;
      for (const t of s.all_tests) {
        const cls = t.passed ? "score-pass" : "score-fail";
        const label = t.passed ? "PASSED" : "FAILED";
        html += `<tr>
          <td>${esc(t.name)}</td><td>${esc(t.test_type)}</td>
          <td class="${cls}">${t.score}%</td><td>${formatDate(t.date)}</td>
          <td><span class="${cls}">${label}</span></td>
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

    if (s.accuracy && s.accuracy.activities_below_threshold.length > 0) {
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

    if (s.accuracy && s.accuracy.repeated_activities.length > 0) {
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

    if (s.deep_dive && s.deep_dive.needed && s.deep_dive.details.length > 0) {
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
        html += `</table>`;
        if (d.analysis && d.analysis.error_analysis) {
          html += `<div class="dd-analysis">
            <h5>Claude Analysis</h5>`;
          if (d.analysis.questions_missed) {
            html += `<div class="dd-analysis-field"><span class="dd-analysis-label">Questions Missed:</span> ${esc(d.analysis.questions_missed)}</div>`;
          }
          html += `<div class="dd-analysis-field"><span class="dd-analysis-label">Error Analysis:</span> ${esc(d.analysis.error_analysis)}</div>`;
          if (d.analysis.root_causes) {
            html += `<div class="dd-analysis-field"><span class="dd-analysis-label">Root Causes:</span> ${esc(d.analysis.root_causes)}</div>`;
          }
          if (d.analysis.recommended_actions) {
            html += `<div class="dd-analysis-field"><span class="dd-analysis-label">Recommended Actions:</span> ${esc(d.analysis.recommended_actions)}</div>`;
          }
          html += `</div>`;
        }
        html += `</div>`;
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

  // ── EG Analysis (separate page) ─────────────────────────────────────

  const CURRICULUM_CAP = 8; // Writing curriculum max grade

  function computeHmgAtDate(tests, cutoffDate) {
    let hmg = 2; // baseline pre-G3
    for (const t of tests) {
      if (t.date <= cutoffDate && t.passed) {
        const m = t.name.match(/G(\d+)/);
        if (m) {
          const g = parseInt(m[1]);
          if (g > hmg) hmg = g;
        }
      }
    }
    return hmg;
  }

  let egAnalysisRendered = false;

  function renderEGAnalysis() {
    if (egAnalysisRendered) return;
    egAnalysisRendered = true;

    const container = document.getElementById("eg-analysis-container");
    const allStudents = studentsForGroup("timeback");
    const sessions = DATA.all_sessions || {};
    const sessionOrder = Object.keys(sessions).sort();
    const MAP_DATE = "2026-05-19";
    const EG_TARGET = 2;

    // Compute S4 weekly boundaries dynamically
    const currentSess = sessions[DATA.session.name];
    const s4Weeks = computeSessionWeeks(DATA.session.name, currentSess);
    const S4_WEEKS = {};
    for (const w of s4Weeks) S4_WEEKS[w.key] = { start: w.start, end: w.end, label: w.label };
    const weekOrder = s4Weeks.map(w => w.key);
    const schoolWeekKeys = s4Weeks.filter(w => !w.isBreak).map(w => w.key);

    // Compute weeks for ALL sessions (for cross-session EG comparison)
    const egSessionWeeksMap = {};
    for (const sk of sessionOrder) {
      egSessionWeeksMap[sk] = computeSessionWeeks(sk, sessions[sk]).filter(w => !w.isBreak);
    }

    // Build both cohorts
    const cohorts = [
      { key: "s1", label: "S1 Writing Cohort", students: allStudents.filter(s => s.s1_cohort === true) },
      { key: "all", label: "All Current Students", students: allStudents },
    ];

    let html = `<h2 style="margin-bottom:16px">Effective Grade Analysis</h2>
      <div style="font-size:0.82rem;color:var(--text-muted);margin-bottom:20px">
        EG = R90 + 1 &middot; EGM = HMG &minus; (EG &minus; 1) &middot; Target: ${EG_TARGET} EGs/year by Spring MAP (${MAP_DATE})
        &middot; Curriculum cap: G${CURRICULUM_CAP}
      </div>
      <div id="eg-drilldown" class="metric-drilldown hidden"></div>`;

    for (const cohort of cohorts) {
      const students = cohort.students;
      const withEG = students.filter(s => s.effective_grade != null);
      const noEG = students.filter(s => s.effective_grade == null);

      // Separate above-curriculum students (EG > G8)
      const aboveCurriculum = withEG.filter(s => s.effective_grade > CURRICULUM_CAP);
      const curriculumComplete = aboveCurriculum.filter(s => s.hmg >= CURRICULUM_CAP);
      const cappedProgressing = aboveCurriculum.filter(s => s.hmg < CURRICULUM_CAP);
      const trackable = withEG.filter(s => s.effective_grade <= CURRICULUM_CAP);

      // EGM buckets (only for trackable students)
      const buckets = { 0: [], 1: [], 2: [], "3+": [] };
      for (const s of trackable) {
        const egm = s.effective_grades_mastered || 0;
        if (egm === 0) buckets[0].push(s);
        else if (egm === 1) buckets[1].push(s);
        else if (egm === 2) buckets[2].push(s);
        else buckets["3+"].push(s);
      }

      const onTarget = buckets[2].length + buckets["3+"].length;
      const onTargetPct = trackable.length > 0 ? Math.round((onTarget / trackable.length) * 100) : 0;

      // EGs passed by session (trackable only)
      const sessionEGs = {};
      for (const sk of sessionOrder) sessionEGs[sk] = { total: 0, students: new Set() };
      const weekEGs = {};
      for (const wk of weekOrder) weekEGs[wk] = { total: 0, students: new Set() };

      // Weekly EGs for ALL sessions (for cross-session comparison)
      const allSessionWeekEGs = {};
      for (const sk of sessionOrder) {
        allSessionWeekEGs[sk] = {};
        for (const w of egSessionWeeksMap[sk]) {
          allSessionWeekEGs[sk][w.key] = { total: 0, students: new Set() };
        }
      }

      for (const s of trackable) {
        const r90 = s.effective_grade - 1;
        const tests = (s.all_tests || []).slice().sort((a, b) => a.date.localeCompare(b.date));
        let prevEgm = 0;
        for (const sk of sessionOrder) {
          const sess = sessions[sk];
          const hmgAtEnd = computeHmgAtDate(tests, sess.end);
          const egmAtEnd = Math.max(0, hmgAtEnd - r90);
          const delta = egmAtEnd - prevEgm;
          if (delta > 0) {
            sessionEGs[sk].total += delta;
            sessionEGs[sk].students.add(s.email);
          }
          prevEgm = egmAtEnd;

          // Weekly EGs for this session
          const sessWeeks = egSessionWeeksMap[sk];
          const hmgBefore = computeHmgAtDate(tests, new Date(new Date(sess.start + "T00:00:00").getTime() - 86400000).toISOString().slice(0, 10));
          let prevWkEgmSess = Math.max(0, hmgBefore - r90);
          for (const w of sessWeeks) {
            const hmgAtWk = computeHmgAtDate(tests, w.end);
            const egmAtWk = Math.max(0, hmgAtWk - r90);
            const d = egmAtWk - prevWkEgmSess;
            if (d > 0) {
              allSessionWeekEGs[sk][w.key].total += d;
              allSessionWeekEGs[sk][w.key].students.add(s.email);
            }
            prevWkEgmSess = egmAtWk;
          }
        }

        // S4 weekly (current session detail with break)
        const hmgBeforeS4 = computeHmgAtDate(tests, "2026-02-20");
        let prevWkEgm = Math.max(0, hmgBeforeS4 - r90);
        for (const wk of weekOrder) {
          const w = S4_WEEKS[wk];
          const hmgAtWk = computeHmgAtDate(tests, w.end);
          const egmAtWk = Math.max(0, hmgAtWk - r90);
          const delta = egmAtWk - prevWkEgm;
          if (delta > 0) {
            weekEGs[wk].total += delta;
            weekEGs[wk].students.add(s.email);
          }
          prevWkEgm = egmAtWk;
        }
      }

      // Pace analysis (based on school weeks only, not break)
      const totalNeeded = buckets[0].length * 2 + buckets[1].length * 1;
      const today = new Date();
      const mapDate = new Date(MAP_DATE);
      const weeksRemaining = Math.max(1, Math.round((mapDate - today) / (7 * 86400000) * 10) / 10);
      const paceNeeded = Math.round(totalNeeded / weeksRemaining * 10) / 10;
      const s4SchoolEGs = schoolWeekKeys.reduce((sum, wk) => sum + weekEGs[wk].total, 0);
      const s4WeeksElapsed = schoolWeekKeys.length;
      const s4Pace = s4WeeksElapsed > 0 ? Math.round(s4SchoolEGs / s4WeeksElapsed * 10) / 10 : 0;
      const onPace = s4Pace >= paceNeeded;

      // Campus EG breakdown (trackable only)
      const campusEG = {};
      for (const s of trackable) {
        const c = s.campus || "Unknown";
        if (!campusEG[c]) campusEG[c] = { total: 0, eg0: 0, eg1: 0, eg2plus: 0, students: [] };
        campusEG[c].total++;
        campusEG[c].students.push(s);
        const egm = s.effective_grades_mastered || 0;
        if (egm === 0) campusEG[c].eg0++;
        else if (egm === 1) campusEG[c].eg1++;
        else campusEG[c].eg2plus++;
      }

      html += `<div class="metrics-section eg-section" data-cohort="${cohort.key}">
        <h2>${esc(cohort.label)}</h2>
        <div style="font-size:0.82rem;color:var(--text-muted);margin-bottom:12px">
          ${students.length} students &middot; ${trackable.length} trackable
          ${aboveCurriculum.length > 0 ? ` &middot; ${aboveCurriculum.length} above curriculum (EG &gt; G${CURRICULUM_CAP})` : ""}
          ${noEG.length > 0 ? ` &middot; ${noEG.length} without EG data` : ""}
        </div>

        <div class="metrics-grid">
          <div class="metric-card clickable" data-metric="eg0-${cohort.key}">
            <div class="metric-value red">${buckets[0].length}</div>
            <div class="metric-label">0 EGs Mastered</div>
            <div class="metric-sub">Need 2 more</div>
          </div>
          <div class="metric-card clickable" data-metric="eg1-${cohort.key}">
            <div class="metric-value orange">${buckets[1].length}</div>
            <div class="metric-label">1 EG Mastered</div>
            <div class="metric-sub">Need 1 more</div>
          </div>
          <div class="metric-card clickable" data-metric="eg2-${cohort.key}">
            <div class="metric-value green">${buckets[2].length}</div>
            <div class="metric-label">2 EGs Mastered</div>
            <div class="metric-sub">On Target</div>
          </div>
          <div class="metric-card clickable" data-metric="eg3plus-${cohort.key}">
            <div class="metric-value green">${buckets["3+"].length}</div>
            <div class="metric-label">3+ EGs Mastered</div>
            <div class="metric-sub">Ahead</div>
          </div>
          ${aboveCurriculum.length > 0 ? `<div class="metric-card clickable" data-metric="aboveCurr-${cohort.key}">
            <div class="metric-value blue">${aboveCurriculum.length}</div>
            <div class="metric-label">Above Curriculum</div>
            <div class="metric-sub">EG &gt; G${CURRICULUM_CAP} (${curriculumComplete.length} complete, ${cappedProgressing.length} progressing)</div>
          </div>` : ""}
          ${noEG.length > 0 ? `<div class="metric-card clickable" data-metric="noEG-${cohort.key}">
            <div class="metric-value">${noEG.length}</div>
            <div class="metric-label">No EG Data</div>
          </div>` : ""}
        </div>

        <div class="eg-pace-box ${onPace ? "on-pace" : "off-pace"}">
          <strong>Pace:</strong> ${s4Pace} EGs/week in S4 (${s4WeeksElapsed} school weeks) ${onPace
            ? `&mdash; on track (need ${paceNeeded}/wk)`
            : `&mdash; behind (need ${paceNeeded}/wk, gap: ${Math.round((paceNeeded - s4Pace) * 10) / 10}/wk)`}
          &middot; ${totalNeeded} EGs still needed across ${trackable.length} trackable students
          &middot; ${weeksRemaining} weeks to MAP
          &middot; ${onTargetPct}% on target (${onTarget}/${trackable.length})
        </div>

        <table class="metrics-table" style="margin-top:12px">
          <tr><th>Session</th><th>EGs Passed</th><th>Students Advancing</th></tr>
          ${sessionOrder.map((sk) => {
            const s = sessionEGs[sk];
            const isCurrent = sk === DATA.session.name;
            return `<tr${isCurrent ? ' style="font-weight:600"' : ""}>
              <td>${esc(sessions[sk].label || sk)}${isCurrent ? " (current)" : ""}</td>
              <td>${s.total}</td>
              <td>${s.students.size}</td>
            </tr>`;
          }).join("")}
          <tr style="font-weight:700;border-top:2px solid var(--border)">
            <td>Total</td>
            <td>${sessionOrder.reduce((sum, sk) => sum + sessionEGs[sk].total, 0)}</td>
            <td>&mdash;</td>
          </tr>
        </table>

        <table class="metrics-table" style="margin-top:12px">
          <tr><th>S4 Week</th><th>EGs Passed</th><th>Students Advancing</th></tr>
          ${weekOrder.map((wk) => {
            const w = weekEGs[wk];
            const isBreak = wk === "Break";
            return `<tr${isBreak ? ' style="color:var(--text-muted);font-style:italic"' : ""}>
              <td>${esc(S4_WEEKS[wk].label)}${isBreak ? " (session break)" : ""}</td>
              <td>${w.total}</td>
              <td>${w.students.size}</td>
            </tr>`;
          }).join("")}
        </table>

        <h3 style="margin-top:16px;margin-bottom:8px">EGs Passed — Week-by-Week Session Comparison</h3>
        <table class="metrics-table" style="margin-top:4px">
          <tr><th>Week</th>${sessionOrder.map(sk => `<th>${esc(sessions[sk].label || sk)}</th>`).join("")}</tr>
          ${(() => {
            const maxWks = Math.max(...sessionOrder.map(sk => egSessionWeeksMap[sk].length));
            let rows = "";
            for (let i = 0; i < maxWks; i++) {
              rows += `<tr><td>Wk${i + 1}</td>`;
              for (const sk of sessionOrder) {
                const wks = egSessionWeeksMap[sk];
                const w = wks[i];
                if (!w) { rows += `<td style="color:var(--text-muted)">—</td>`; continue; }
                const d = allSessionWeekEGs[sk][w.key];
                rows += `<td>${d ? d.total : 0}</td>`;
              }
              rows += `</tr>`;
            }
            rows += `<tr style="font-weight:700;border-top:2px solid var(--border)"><td>Total</td>`;
            for (const sk of sessionOrder) {
              const wks = egSessionWeeksMap[sk];
              const total = wks.reduce((sum, w) => sum + (allSessionWeekEGs[sk][w.key]?.total || 0), 0);
              rows += `<td>${total}</td>`;
            }
            rows += `</tr>`;
            return rows;
          })()}
        </table>

        <table class="metrics-table" style="margin-top:12px">
          <tr><th>Campus</th><th>Trackable</th><th>0 EG</th><th>1 EG</th><th>2+ EGs</th><th>On Target %</th></tr>
          ${Object.keys(campusEG).sort().map((c) => {
            const d = campusEG[c];
            const otPct = d.total > 0 ? Math.round((d.eg2plus / d.total) * 100) : 0;
            return `<tr class="clickable-row" data-metric="egCampus-${cohort.key}" data-campus="${esc(c)}">
              <td>${esc(c)}</td>
              <td>${d.total}</td>
              <td>${d.eg0 > 0 ? '<span class="score-fail">' + d.eg0 + '</span>' : '0'}</td>
              <td>${d.eg1 > 0 ? '<span style="color:var(--orange)">' + d.eg1 + '</span>' : '0'}</td>
              <td>${d.eg2plus > 0 ? '<span class="score-pass">' + d.eg2plus + '</span>' : '0'}</td>
              <td><div class="bar-cell">${otPct}% <div class="bar-bg"><div class="bar-fill ${otPct >= 50 ? "green" : otPct >= 25 ? "orange" : "red"}" style="width:${otPct}%"></div></div></div></td>
            </tr>`;
          }).join("")}
        </table>

        ${(() => {
          // Language EG mastered but not Writing EG
          const langMasteredNotWriting = students.filter(s => {
            if (!s.language_eg || !s.effective_grade) return false;
            const langEgm = Math.max(0, s.hmg - (s.language_eg - 1));
            const writingEgm = s.effective_grades_mastered || 0;
            return langEgm >= 2 && writingEgm < 2;
          });
          if (langMasteredNotWriting.length === 0) return "";
          return `
            <h3 style="margin-top:16px;margin-bottom:8px">Language EG Mastered, Writing EG Not Mastered (${langMasteredNotWriting.length})</h3>
            <p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:8px">
              Students who have mastered their EG in Language (2+ EGM) but not in Writing (&lt; 2 EGM).
            </p>
            <table class="metrics-table">
              <tr><th>Name</th><th>Campus</th><th>HMG</th><th>Writing EG</th><th>Writing EGM</th><th>Language EG</th><th>Language EGM</th></tr>
              ${langMasteredNotWriting.sort((a, b) => a.name.localeCompare(b.name)).map(s => {
                const wEgm = s.effective_grades_mastered || 0;
                const lEgm = Math.max(0, s.hmg - (s.language_eg - 1));
                return `<tr>
                  <td>${esc(s.name)}</td>
                  <td>${esc(s.campus)}</td>
                  <td>G${s.hmg}</td>
                  <td>G${s.effective_grade}</td>
                  <td class="${wEgm < 2 ? 'score-fail' : 'score-pass'}">${wEgm}</td>
                  <td>G${s.language_eg}</td>
                  <td class="score-pass">${lEgm}</td>
                </tr>`;
              }).join("")}
            </table>`;
        })()}
      </div>`;
    }

    container.innerHTML = html;

    // Wire up clickable metrics
    const s1Students = allStudents.filter(s => s.s1_cohort === true);

    function egBucket(list, egmValue) {
      return list.filter(s => {
        if (s.effective_grade == null || s.effective_grade > CURRICULUM_CAP) return false;
        const egm = s.effective_grades_mastered || 0;
        if (egmValue === "3+") return egm >= 3;
        return egm === egmValue;
      });
    }

    const egMetricLookup = {
      "eg0-s1": { title: "S1 Cohort: 0 EGs Mastered", list: egBucket(s1Students, 0) },
      "eg1-s1": { title: "S1 Cohort: 1 EG Mastered", list: egBucket(s1Students, 1) },
      "eg2-s1": { title: "S1 Cohort: 2 EGs Mastered", list: egBucket(s1Students, 2) },
      "eg3plus-s1": { title: "S1 Cohort: 3+ EGs Mastered", list: egBucket(s1Students, "3+") },
      "aboveCurr-s1": { title: "S1 Cohort: Above Curriculum (EG > G8)", list: s1Students.filter(s => s.effective_grade != null && s.effective_grade > CURRICULUM_CAP) },
      "noEG-s1": { title: "S1 Cohort: No EG Data", list: s1Students.filter(s => s.effective_grade == null) },
      "eg0-all": { title: "All Students: 0 EGs Mastered", list: egBucket(allStudents, 0) },
      "eg1-all": { title: "All Students: 1 EG Mastered", list: egBucket(allStudents, 1) },
      "eg2-all": { title: "All Students: 2 EGs Mastered", list: egBucket(allStudents, 2) },
      "eg3plus-all": { title: "All Students: 3+ EGs Mastered", list: egBucket(allStudents, "3+") },
      "aboveCurr-all": { title: "All Students: Above Curriculum (EG > G8)", list: allStudents.filter(s => s.effective_grade != null && s.effective_grade > CURRICULUM_CAP) },
      "noEG-all": { title: "All Students: No EG Data", list: allStudents.filter(s => s.effective_grade == null) },
    };

    container.querySelectorAll(".metric-card.clickable").forEach((card) => {
      card.addEventListener("click", () => {
        const key = card.dataset.metric;
        const info = egMetricLookup[key];
        if (info) showEGDrilldown(info.title, info.list);
      });
    });

    container.querySelectorAll(".clickable-row").forEach((row) => {
      row.addEventListener("click", () => {
        const metric = row.dataset.metric;
        if (metric && metric.startsWith("egCampus-")) {
          const cohortKey = metric.replace("egCampus-", "");
          const campus = row.dataset.campus;
          const cohortList = cohortKey === "s1" ? s1Students : allStudents;
          const list = cohortList.filter(s => s.effective_grade != null && s.effective_grade <= CURRICULUM_CAP && (s.campus || "Unknown") === campus);
          showEGDrilldown(`${cohortKey === "s1" ? "S1 Cohort" : "All Students"} — Campus: ${campus}`, list);
        }
      });
    });
  }

  function showEGDrilldown(title, students) {
    const el = document.getElementById("eg-drilldown");
    if (!el) return;

    let html = `
      <div class="drilldown-header">
        <h3>${esc(title)} (${students.length})</h3>
        <button class="drilldown-close">&times;</button>
      </div>
      <table class="metrics-table drilldown-table">
        <tr>
          <th>Name</th><th>Email</th><th>Campus</th><th>Level</th>
          <th>HMG</th><th>EG</th><th>EGM</th><th>XP</th><th>Test XP</th><th>Last Test</th><th>Insights</th>
        </tr>
    `;

    const sorted = [...students].sort((a, b) => a.name.localeCompare(b.name));
    for (const s of sorted) {
      const drillSchoolXp = s.xp.school != null ? s.xp.school : s.xp.total;
      const xpPct = s.xp.goal_to_date > 0 ? Math.round((drillSchoolXp / s.xp.goal_to_date) * 100) : 0;
      const xpCls = s.xp.meets_goal ? "score-pass" : "score-fail";
      const lastTest = s.last_test
        ? `${s.last_test.name} (${s.last_test.score}%) ${s.last_test.passed ? "\u2713" : "\u2717"}`
        : "-";
      const insightCount = s.insights.length;
      const testXp = s.xp_details && s.xp_details.test_xp_total ? Math.round(s.xp_details.test_xp_total) : (s.xp.test ? Math.round(s.xp.test) : 0);
      const egmVal = s.effective_grades_mastered;
      const aboveCurr = s.effective_grade != null && s.effective_grade > CURRICULUM_CAP;
      const egmDisplay = aboveCurr ? (s.hmg >= CURRICULUM_CAP ? "Complete" : "Capped") : (egmVal != null ? egmVal : "-");
      const egmCls = aboveCurr ? "score-pass" : (egmVal == null ? "" : egmVal >= 2 ? "score-pass" : egmVal === 0 ? "score-fail" : "");

      html += `<tr class="drilldown-student-row" data-student-id="${esc(s.id || s.email)}">
        <td><strong class="drilldown-student-link">${esc(s.name)}</strong></td>
        <td>${esc(s.email)}</td>
        <td>${esc(s.campus)}</td>
        <td>${esc(s.level)}</td>
        <td>G${s.hmg}</td>
        <td>${s.effective_grade ? `G${s.effective_grade}` : "-"}</td>
        <td class="${egmCls}">${egmDisplay}</td>
        <td class="${xpCls}">${Math.round(drillSchoolXp)}/${Math.round(s.xp.goal_to_date)} (${xpPct}%)</td>
        <td>${testXp > 0 ? testXp : "-"}</td>
        <td>${lastTest}</td>
        <td>${insightCount > 0 ? `<span class="score-fail">${insightCount}</span>` : '<span class="score-pass">0</span>'}</td>
      </tr>`;

      if (hasExpandableContent(s)) {
        const ddAnalysis = buildDeepDiveAnalysisHTML(s);
        html += `<tr class="drilldown-insights-row hidden" data-for="${esc(s.id || s.email)}">
          <td colspan="11">
            <div class="drilldown-insights">
              ${s.insights.map((ins) => `<div class="insight-item"><span class="insight-dot ${ins.severity}"></span>${esc(ins.text)}</div>`).join("")}
              ${s.session_tests && s.session_tests.length > 0 ? `
                <div style="margin-top:8px"><strong>Session Tests:</strong></div>
                <table class="detail-table" style="margin-top:4px">
                  <tr><th>Test</th><th>Type</th><th>Score</th><th>Date</th><th>XP</th><th></th></tr>
                  ${s.session_tests.map((t) => {
                    const cls = t.passed ? "score-pass" : "score-fail";
                    const rushed = t.rushed ? '<span class="rushed-tag">RUSHED</span>' : "";
                    const tXp = s.xp_details && s.xp_details.test_xp
                      ? s.xp_details.test_xp.find((x) => x.name === t.name && x.date === t.date)
                      : null;
                    return `<tr><td>${esc(t.name)}</td><td>${esc(t.type)}</td><td class="${cls}">${t.score}%</td><td>${formatDate(t.date)}</td><td>${tXp ? tXp.xp : "-"}</td><td>${rushed}</td></tr>`;
                  }).join("")}
                </table>` : ""}
              ${ddAnalysis}
            </div>
          </td>
        </tr>`;
      }
    }
    html += `</table>`;

    el.innerHTML = html;
    el.classList.remove("hidden");

    el.querySelector(".drilldown-close").addEventListener("click", () => {
      el.classList.add("hidden");
    });

    el.querySelectorAll(".drilldown-student-row").forEach((row) => {
      row.addEventListener("click", () => {
        const sid = row.dataset.studentId;
        const insightsRow = el.querySelector(`.drilldown-insights-row[data-for="${sid}"]`);
        if (insightsRow) insightsRow.classList.toggle("hidden");
      });
    });

    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ── Metrics Page ────────────────────────────────────────────────────
  function renderMetrics(group) {
    const container = document.getElementById("metrics-" + group);
    const students = studentsForGroup(group);
    const total = students.length;
    const g8Done = students.filter((s) => s.completed_g8);
    const active = students.filter((s) => !s.completed_g8);
    const activeCount = active.length;
    const xpOk = active.filter((s) => s.xp.meets_goal);
    const xpBehind = active.filter((s) => !s.xp.meets_goal);
    const dd = active.filter((s) => s.deep_dive.needed);
    const accFlags = active.filter((s) => s.accuracy.activities_below_threshold.length > 0);
    const noTests = students.filter((s) => !s.last_test);
    const xpPct = activeCount > 0 ? Math.round((xpOk.length / activeCount) * 100) : 0;

    // Test metrics
    let totalTestsPassed = 0;
    let endOfCoursePassed = 0;
    let testOutsPassed = 0;
    let placementPassed = 0;
    const studentsPassingTests = [];
    students.forEach((s) => {
      const ts = s.test_summary || {};
      if (ts.total_passed > 0) {
        totalTestsPassed += ts.total_passed;
        studentsPassingTests.push(s);
      }
      endOfCoursePassed += ts.end_of_course_passed || 0;
      testOutsPassed += ts.test_outs_passed || 0;
      placementPassed += ts.placement_passed || 0;
    });

    // Per-session test breakdown
    const sessions = DATA.all_sessions || {};
    const sessionOrder = Object.keys(sessions).sort();
    const sessionTestStats = {};
    for (const sKey of sessionOrder) {
      sessionTestStats[sKey] = { label: sessions[sKey].label || sKey, taken: 0, passed: 0, eoc: 0, testOut: 0, placement: 0, studentsPassing: new Set() };
    }
    let allTimeTaken = 0;
    students.forEach((s) => {
      const tests = s.all_tests || [];
      for (const t of tests) {
        const d = t.date;
        for (const sKey of sessionOrder) {
          const sess = sessions[sKey];
          if (d >= sess.start && d <= sess.end) {
            sessionTestStats[sKey].taken++;
            allTimeTaken++;
            if (t.passed) {
              sessionTestStats[sKey].passed++;
              if (t.test_type === "end of course") sessionTestStats[sKey].eoc++;
              if (t.test_type === "test out") sessionTestStats[sKey].testOut++;
              if (t.test_type === "placement") sessionTestStats[sKey].placement++;
              sessionTestStats[sKey].studentsPassing.add(s.email);
            }
            break;
          }
        }
      }
    });

    // Differentiated EoC breakdown for S4+ sessions
    // For each student, group their "end of course" tests by grade-level test name,
    // sort chronologically, then label: 1st = Mastery Test, 2nd = Retake 1, etc.
    const detailedSessionStats = {};
    const detailedSessionOrder = sessionOrder.filter((k) => k >= "S4");
    for (const sKey of detailedSessionOrder) {
      detailedSessionStats[sKey] = { label: sessions[sKey].label || sKey, rows: {} };
    }

    students.forEach((s) => {
      const tests = s.all_tests || [];
      // Group all "end of course" tests by grade level (e.g. "G5.2") across all time
      // to determine attempt number
      const eocByGrade = {};
      for (const t of tests) {
        if (t.test_type !== "end of course") continue;
        // Extract grade key, e.g. "G5.2" from "Alpha Standardized Writing G5.2"
        const m = t.name.match(/G(\d+\.\d+)/);
        const gradeKey = m ? m[1] : t.name;
        if (!eocByGrade[gradeKey]) eocByGrade[gradeKey] = [];
        eocByGrade[gradeKey].push(t);
      }

      // Sort each grade group by date and assign attempt numbers
      for (const gradeKey of Object.keys(eocByGrade)) {
        const sorted = eocByGrade[gradeKey].sort((a, b) => a.date.localeCompare(b.date));
        sorted.forEach((t, i) => {
          t._attemptNum = i + 1; // 1-based
        });
      }

      // Also tag test-out and placement tests
      for (const t of tests) {
        if (t.test_type === "test out") t._attemptLabel = "Test-Out";
        else if (t.test_type === "placement") t._attemptLabel = "Placement";
      }

      // Now bucket into detailed session stats
      for (const t of tests) {
        const d = t.date;
        for (const sKey of detailedSessionOrder) {
          const sess = sessions[sKey];
          if (d >= sess.start && d <= sess.end) {
            const stats = detailedSessionStats[sKey];
            let label;
            if (t._attemptLabel) {
              label = t._attemptLabel;
            } else if (t._attemptNum) {
              label = t._attemptNum === 1 ? "End of Course 1 (Mastery Test)"
                : `End of Course ${t._attemptNum} (Retake ${t._attemptNum - 1})`;
            } else {
              break; // not an end of course / test out / placement
            }
            if (!stats.rows[label]) stats.rows[label] = { taken: 0, passed: 0 };
            stats.rows[label].taken++;
            if (t.passed) stats.rows[label].passed++;
            break;
          }
        }
      }
    });

    // Build campus breakdown
    const campusMap = {};
    students.forEach((s) => {
      const c = s.campus || "Unknown";
      if (!campusMap[c]) campusMap[c] = { students: [], total: 0, g8: 0, xpOk: 0, dd: 0, accFlags: 0, testsPassed: 0 };
      campusMap[c].students.push(s);
      campusMap[c].total++;
      if (s.completed_g8) { campusMap[c].g8++; return; }
      if (s.xp.meets_goal) campusMap[c].xpOk++;
      if (s.deep_dive.needed) campusMap[c].dd++;
      if (s.accuracy.activities_below_threshold.length > 0) campusMap[c].accFlags++;
      campusMap[c].testsPassed += (s.test_summary || {}).total_passed || 0;
    });

    // Build level breakdown
    const levelMap = {};
    students.forEach((s) => {
      const l = s.level || "Unknown";
      if (!levelMap[l]) levelMap[l] = { students: [], total: 0, g8: 0, xpOk: 0, dd: 0 };
      levelMap[l].students.push(s);
      levelMap[l].total++;
      if (s.completed_g8) { levelMap[l].g8++; return; }
      if (s.xp.meets_goal) levelMap[l].xpOk++;
      if (s.deep_dive.needed) levelMap[l].dd++;
    });

    let html = `<h2 style="margin-bottom:16px">Timeback Metrics</h2>

      <div class="metrics-grid">
        <div class="metric-card clickable" data-metric="total">
          <div class="metric-value blue">${total}</div>
          <div class="metric-label">Total Students</div>
        </div>
        <div class="metric-card clickable" data-metric="g8">
          <div class="metric-value green">${g8Done.length}</div>
          <div class="metric-label">Completed G8 Writing</div>
        </div>
        <div class="metric-card clickable" data-metric="xpOk">
          <div class="metric-value green">${xpOk.length}</div>
          <div class="metric-label">XP On Track</div>
          <div class="metric-sub">${xpPct}% of ${activeCount} active</div>
        </div>
        <div class="metric-card clickable" data-metric="xpBehind">
          <div class="metric-value ${xpBehind.length > 0 ? "orange" : ""}">${xpBehind.length}</div>
          <div class="metric-label">XP Behind</div>
        </div>
        <div class="metric-card clickable" data-metric="dd">
          <div class="metric-value red">${dd.length}</div>
          <div class="metric-label">Deep Dives Needed</div>
        </div>
        <div class="metric-card clickable" data-metric="accFlags">
          <div class="metric-value orange">${accFlags.length}</div>
          <div class="metric-label">Accuracy Flags</div>
          <div class="metric-sub">AlphaWrite &lt;${DATA.thresholds.accuracy_pct}%</div>
        </div>
        <div class="metric-card clickable" data-metric="noTests">
          <div class="metric-value">${noTests.length}</div>
          <div class="metric-label">No Tests Taken</div>
        </div>
        <div class="metric-card">
          <div class="metric-value">${DATA.session.school_days_elapsed}</div>
          <div class="metric-label">School Days Elapsed</div>
          <div class="metric-sub">Goal: ${DATA.thresholds.xp_per_day} XP/day</div>
        </div>
      </div>

      <div class="metric-drilldown hidden" id="metric-drilldown"></div>

      <div class="metrics-section"><h2>Writing Test Metrics</h2>
        <div class="metrics-grid">
          <div class="metric-card clickable" data-metric="testsPassed">
            <div class="metric-value blue">${totalTestsPassed}</div>
            <div class="metric-label">Tests Passed (All Time)</div>
          </div>
          <div class="metric-card clickable" data-metric="studentsPassingTests">
            <div class="metric-value blue">${studentsPassingTests.length}</div>
            <div class="metric-label">Students Passing Tests</div>
          </div>
          <div class="metric-card clickable" data-metric="eocPassed">
            <div class="metric-value">${endOfCoursePassed}</div>
            <div class="metric-label">End of Course Passed</div>
          </div>
          <div class="metric-card clickable" data-metric="toPassed">
            <div class="metric-value">${testOutsPassed}</div>
            <div class="metric-label">Test-Outs Passed</div>
          </div>
          <div class="metric-card clickable" data-metric="placementPassed">
            <div class="metric-value">${placementPassed}</div>
            <div class="metric-label">Placement Passed</div>
          </div>
        </div>
        <table class="metrics-table" style="margin-top:16px">
          <tr><th>Session</th><th>Passed / Taken</th><th>Pass Rate</th><th>Students Passing</th><th>End of Course</th><th>Test-Outs</th><th>Placement</th></tr>
          ${sessionOrder.map((sKey) => {
            const ss = sessionTestStats[sKey];
            const isCurrent = sKey === DATA.session.name;
            const pct = ss.taken > 0 ? Math.round((ss.passed / ss.taken) * 100) : 0;
            return `<tr${isCurrent ? ' style="font-weight:600"' : ""}>
              <td>${esc(ss.label)}${isCurrent ? " (current)" : ""}</td>
              <td>${ss.passed} / ${ss.taken}</td>
              <td>${pct}%</td>
              <td>${ss.studentsPassing.size}</td>
              <td>${ss.eoc}</td>
              <td>${ss.testOut}</td>
              <td>${ss.placement}</td>
            </tr>`;
          }).join("")}
          <tr style="font-weight:700;border-top:2px solid var(--border)">
            <td>All Time</td>
            <td>${totalTestsPassed} / ${allTimeTaken}</td>
            <td>${allTimeTaken > 0 ? Math.round((totalTestsPassed / allTimeTaken) * 100) : 0}%</td>
            <td>${studentsPassingTests.length}</td>
            <td>${endOfCoursePassed}</td>
            <td>${testOutsPassed}</td>
            <td>${placementPassed}</td>
          </tr>
        </table>
      </div>
    `;

    // Differentiated test breakdown tables for S4+
    for (const sKey of detailedSessionOrder) {
      const ds = detailedSessionStats[sKey];
      const rowLabels = Object.keys(ds.rows);
      if (rowLabels.length === 0) continue;

      // Sort: Test-Out first, then End of Course 1, 2, 3..., then Placement
      rowLabels.sort((a, b) => {
        const order = (l) => {
          if (l === "Test-Out") return 0;
          if (l.startsWith("End of Course")) {
            const n = parseInt(l.match(/\d+/)?.[0] || "99");
            return 10 + n;
          }
          if (l === "Placement") return 100;
          return 50;
        };
        return order(a) - order(b);
      });

      let totalTaken = 0, totalPassed = 0;
      const isCurrent = sKey === DATA.session.name;

      html += `<div class="metrics-section"><h2>${esc(ds.label)} Test Breakdown${isCurrent ? " (current)" : ""}</h2>
        <table class="metrics-table">
          <tr><th>Test Type</th><th>Taken</th><th>Passed</th><th>Pass Rate</th></tr>`;
      for (const label of rowLabels) {
        const r = ds.rows[label];
        totalTaken += r.taken;
        totalPassed += r.passed;
        const pct = r.taken > 0 ? Math.round((r.passed / r.taken) * 100) : 0;
        html += `<tr>
          <td>${esc(label)}</td>
          <td>${r.taken}</td>
          <td>${r.passed}</td>
          <td>${pct}%</td>
        </tr>`;
      }
      const totalPct = totalTaken > 0 ? Math.round((totalPassed / totalTaken) * 100) : 0;
      html += `<tr style="font-weight:700;border-top:2px solid var(--border)">
        <td>Total</td>
        <td>${totalTaken}</td>
        <td>${totalPassed}</td>
        <td>${totalPct}%</td>
      </tr></table></div>`;
    }

    html += `<div class="metrics-section"><h2>By Campus</h2>
      <table class="metrics-table">
        <tr><th>Campus</th><th>Students</th><th>G8 Done</th><th>XP On Track</th><th>Deep Dives</th><th>Accuracy Flags</th><th>Tests Passed</th></tr>`;
    for (const c of Object.keys(campusMap).sort()) {
      const d = campusMap[c];
      const activeC = d.total - d.g8;
      const xpPctC = activeC > 0 ? Math.round((d.xpOk / activeC) * 100) : 0;
      html += `<tr class="clickable-row" data-metric="campus" data-campus="${esc(c)}">
        <td>${esc(c)}</td>
        <td>${d.total}</td>
        <td>${d.g8}</td>
        <td><div class="bar-cell">${d.xpOk}/${activeC} (${xpPctC}%) <div class="bar-bg"><div class="bar-fill ${xpPctC >= 70 ? "green" : xpPctC >= 40 ? "orange" : "red"}" style="width:${xpPctC}%"></div></div></div></td>
        <td>${d.dd > 0 ? '<span class="score-fail">' + d.dd + '</span>' : '0'}</td>
        <td>${d.accFlags > 0 ? '<span class="score-fail">' + d.accFlags + '</span>' : '0'}</td>
        <td>${d.testsPassed}</td>
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
      html += `<tr class="clickable-row" data-metric="level" data-level="${esc(l)}">
        <td>${esc(l)}</td>
        <td>${d.total}</td>
        <td>${d.g8}</td>
        <td><div class="bar-cell">${d.xpOk}/${activeL} (${xpPctL}%) <div class="bar-bg"><div class="bar-fill ${xpPctL >= 70 ? "green" : xpPctL >= 40 ? "orange" : "red"}" style="width:${xpPctL}%"></div></div></div></td>
        <td>${d.dd > 0 ? '<span class="score-fail">' + d.dd + '</span>' : '0'}</td>
      </tr>`;
    }
    html += `</table></div>`;

    container.innerHTML = html;

    // Wire up clickable metrics
    const metricLookup = {
      total: { title: "All Students", list: students },
      g8: { title: "Completed G8 Writing", list: g8Done },
      xpOk: { title: "XP On Track", list: xpOk },
      xpBehind: { title: "XP Behind", list: xpBehind },
      dd: { title: "Deep Dives Needed", list: dd },
      accFlags: { title: "Accuracy Flags", list: accFlags },
      noTests: { title: "No Tests Taken", list: noTests },
      testsPassed: { title: "Students with Passed Tests", list: studentsPassingTests },
      studentsPassingTests: { title: "Students Passing Tests", list: studentsPassingTests },
      eocPassed: { title: "Students with End of Course Passes", list: students.filter(s => (s.test_summary || {}).end_of_course_passed > 0) },
      toPassed: { title: "Students with Test-Out Passes", list: students.filter(s => (s.test_summary || {}).test_outs_passed > 0) },
      placementPassed: { title: "Students with Placement Passes", list: students.filter(s => (s.test_summary || {}).placement_passed > 0) },
    };

    container.querySelectorAll(".metric-card.clickable").forEach((card) => {
      card.addEventListener("click", () => {
        const key = card.dataset.metric;
        const info = metricLookup[key];
        if (info) showDrilldown(info.title, info.list);
      });
    });

    container.querySelectorAll(".clickable-row").forEach((row) => {
      row.addEventListener("click", () => {
        const metric = row.dataset.metric;
        if (metric === "campus") {
          const campus = row.dataset.campus;
          const list = (campusMap[campus] || {}).students || [];
          showDrilldown(`Campus: ${campus}`, list);
        } else if (metric === "level") {
          const level = row.dataset.level;
          const list = (levelMap[level] || {}).students || [];
          showDrilldown(`Level: ${level}`, list);
        }
      });
    });
  }

  // ── Deep Dive Analysis HTML helper ──────────────────────────────────
  function buildDeepDiveAnalysisHTML(s) {
    if (!s.deep_dive || !s.deep_dive.needed || !s.deep_dive.details || s.deep_dive.details.length === 0) return "";
    let html = "";
    for (const d of s.deep_dive.details) {
      html += `<div style="margin-top:8px"><strong>Deep Dive: G${d.grade}</strong>
        <span style="font-size:0.78rem;color:var(--text-muted);margin-left:8px">${d.failed_count} failed / ${d.rushed_count} rushed / avg ${d.avg_time_minutes} min</span>
      </div>`;
      if (d.analysis && d.analysis.error_analysis) {
        html += `<div class="dd-student-analysis">`;
        if (d.analysis.questions_missed) {
          html += `<div class="dd-analysis-field"><span class="dd-analysis-label">Questions Missed:</span> ${esc(d.analysis.questions_missed)}</div>`;
        }
        html += `<div class="dd-analysis-field"><span class="dd-analysis-label">Error Analysis:</span> ${esc(d.analysis.error_analysis)}</div>`;
        if (d.analysis.root_causes) {
          html += `<div class="dd-analysis-field"><span class="dd-analysis-label">Root Causes:</span> ${esc(d.analysis.root_causes)}</div>`;
        }
        if (d.analysis.recommended_actions) {
          html += `<div class="dd-analysis-field"><span class="dd-analysis-label">Recommended Actions:</span> ${esc(d.analysis.recommended_actions)}</div>`;
        }
        html += `</div>`;
      }
    }
    return html;
  }

  function hasExpandableContent(s) {
    return s.insights.length > 0
      || (s.session_tests && s.session_tests.length > 0)
      || (s.deep_dive && s.deep_dive.needed && s.deep_dive.details && s.deep_dive.details.length > 0);
  }

  // ── Drill-down panel ────────────────────────────────────────────────
  function showDrilldown(title, students) {
    const el = document.getElementById("metric-drilldown");
    if (!el) return;

    let html = `
      <div class="drilldown-header">
        <h3>${esc(title)} (${students.length})</h3>
        <button class="drilldown-close">&times;</button>
      </div>
      <table class="metrics-table drilldown-table">
        <tr>
          <th>Name</th><th>Email</th><th>Campus</th><th>Level</th>
          <th>HMG</th><th>EG</th><th>EGM</th><th>XP</th><th>Test XP</th><th>Last Test</th><th>Insights</th>
        </tr>
    `;

    const sorted = [...students].sort((a, b) => a.name.localeCompare(b.name));
    for (const s of sorted) {
      const egSchoolXp = s.xp.school != null ? s.xp.school : s.xp.total;
      const xpPct = s.xp.goal_to_date > 0 ? Math.round((egSchoolXp / s.xp.goal_to_date) * 100) : 0;
      const xpCls = s.xp.meets_goal ? "score-pass" : "score-fail";
      const lastTest = s.last_test
        ? `${s.last_test.name} (${s.last_test.score}%) ${s.last_test.passed ? "✓" : "✗"}`
        : "-";
      const insightCount = s.insights.length;
      const testXp = s.xp_details && s.xp_details.test_xp_total ? Math.round(s.xp_details.test_xp_total) : (s.xp.test ? Math.round(s.xp.test) : 0);

      const egmVal = s.effective_grades_mastered;
      const egmCls = egmVal == null ? "" : egmVal >= 2 ? "score-pass" : egmVal === 0 ? "score-fail" : "";

      html += `<tr class="drilldown-student-row" data-student-id="${esc(s.id || s.email)}">
        <td><strong class="drilldown-student-link">${esc(s.name)}</strong></td>
        <td>${esc(s.email)}</td>
        <td>${esc(s.campus)}</td>
        <td>${esc(s.level)}</td>
        <td>G${s.hmg}</td>
        <td>${s.effective_grade ? `G${s.effective_grade}` : "-"}</td>
        <td class="${egmCls}">${egmVal != null ? egmVal : "-"}</td>
        <td class="${xpCls}">${Math.round(egSchoolXp)}/${Math.round(s.xp.goal_to_date)} (${xpPct}%)</td>
        <td>${testXp > 0 ? testXp : "-"}</td>
        <td>${lastTest}</td>
        <td>${insightCount > 0 ? `<span class="score-fail">${insightCount}</span>` : '<span class="score-pass">0</span>'}</td>
      </tr>`;

      // Hidden expandable row (insights + session tests + deep dive analysis)
      if (hasExpandableContent(s)) {
        const ddAnalysis = buildDeepDiveAnalysisHTML(s);
        html += `<tr class="drilldown-insights-row hidden" data-for="${esc(s.id || s.email)}">
          <td colspan="11">
            <div class="drilldown-insights">
              ${s.insights.map((ins) => `<div class="insight-item"><span class="insight-dot ${ins.severity}"></span>${esc(ins.text)}</div>`).join("")}
              ${s.session_tests && s.session_tests.length > 0 ? `
                <div style="margin-top:8px"><strong>Session Tests:</strong></div>
                <table class="detail-table" style="margin-top:4px">
                  <tr><th>Test</th><th>Type</th><th>Score</th><th>Date</th><th>XP</th><th></th></tr>
                  ${s.session_tests.map((t) => {
                    const cls = t.passed ? "score-pass" : "score-fail";
                    const rushed = t.rushed ? '<span class="rushed-tag">RUSHED</span>' : "";
                    const tXp = s.xp_details && s.xp_details.test_xp
                      ? s.xp_details.test_xp.find((x) => x.name === t.name && x.date === t.date)
                      : null;
                    return `<tr><td>${esc(t.name)}</td><td>${esc(t.type)}</td><td class="${cls}">${t.score}%</td><td>${formatDate(t.date)}</td><td>${tXp ? tXp.xp : "-"}</td><td>${rushed}</td></tr>`;
                  }).join("")}
                </table>` : ""}
              ${ddAnalysis}
            </div>
          </td>
        </tr>`;
      }
    }
    html += `</table>`;

    el.innerHTML = html;
    el.classList.remove("hidden");

    el.querySelector(".drilldown-close").addEventListener("click", () => {
      el.classList.add("hidden");
    });

    // Wire clickable student rows to toggle insights
    el.querySelectorAll(".drilldown-student-row").forEach((row) => {
      row.addEventListener("click", () => {
        const sid = row.dataset.studentId;
        const insightsRow = el.querySelector(`.drilldown-insights-row[data-for="${sid}"]`);
        if (insightsRow) insightsRow.classList.toggle("hidden");
      });
    });

    // Scroll to drilldown
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ── Test Results Page ─────────────────────────────────────────────────
  let testResultsRendered = false;

  function renderTestResults() {
    if (testResultsRendered) return;
    testResultsRendered = true;

    const container = document.getElementById("test-results-container");
    const students = studentsForGroup("timeback");
    const sessions = DATA.all_sessions || {};
    const currentSession = DATA.session.name; // e.g. "S4"
    const sess = sessions[currentSession];
    if (!sess) {
      container.innerHTML = '<div class="loading">No session data available.</div>';
      return;
    }

    // Collect all tests in current session with student info
    const rows = [];
    const studentMap = {};
    students.forEach((s) => {
      studentMap[s.email] = s;

      // Group EoC tests by grade to determine attempt labels
      const eocByGrade = {};
      const tests = s.all_tests || [];
      for (const t of tests) {
        if (t.test_type === "end of course") {
          const m = t.name.match(/G(\d+\.\d+)/);
          const gradeKey = m ? m[1] : t.name;
          if (!eocByGrade[gradeKey]) eocByGrade[gradeKey] = [];
          eocByGrade[gradeKey].push(t);
        }
      }
      for (const gradeKey of Object.keys(eocByGrade)) {
        eocByGrade[gradeKey].sort((a, b) => a.date.localeCompare(b.date));
        eocByGrade[gradeKey].forEach((t, i) => { t._attemptNum = i + 1; });
      }

      for (const t of tests) {
        if (t.date >= sess.start && t.date <= sess.end) {
          let attemptLabel;
          if (t.test_type === "test out") {
            attemptLabel = "Test-Out";
          } else if (t.test_type === "placement") {
            attemptLabel = "Placement";
          } else if (t._attemptNum) {
            attemptLabel = t._attemptNum === 1 ? "Mastery Test" : `Retake ${t._attemptNum - 1}`;
          } else {
            attemptLabel = t.test_type || "Unknown";
          }

          rows.push({
            name: s.name,
            email: s.email,
            campus: s.campus,
            level: s.level,
            age_grade: s.age_grade,
            hmg: s.hmg,
            effective_grade: s.effective_grade,
            test_name: t.name,
            test_type: attemptLabel,
            raw_type: t.test_type,
            score: t.score,
            passed: t.passed,
            date: t.date,
            total_questions: t.total_questions,
            correct_questions: t.correct_questions,
          });
        }
      }
    });

    // Sort by date descending (most recent first), then by student name
    rows.sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));

    // Summary stats
    const totalTests = rows.length;
    const totalPassed = rows.filter((r) => r.passed).length;
    const totalFailed = totalTests - totalPassed;
    const passRate = totalTests > 0 ? Math.round((totalPassed / totalTests) * 100) : 0;
    const uniqueStudents = new Set(rows.map((r) => r.email)).size;

    // Per-date grouping for the daily view
    const byDate = {};
    rows.forEach((r) => {
      if (!byDate[r.date]) byDate[r.date] = [];
      byDate[r.date].push(r);
    });
    const sortedDates = Object.keys(byDate).sort().reverse();

    // Build filter state
    const trFilters = { campus: "all", type: "all", result: "all", search: "" };

    // Unique campuses and test types from rows
    const campuses = [...new Set(rows.map((r) => r.campus).filter(Boolean))].sort();
    const testTypes = [...new Set(rows.map((r) => r.test_type))].sort();

    // ── Week-by-week tests passed comparison across all sessions ──
    const sessionKeys = Object.keys(sessions).sort();
    const allTests = [];
    students.forEach((s) => {
      for (const t of s.all_tests || []) {
        allTests.push({ ...t, email: s.email });
      }
    });

    // Compute weeks for each session
    const sessionWeeksMap = {};
    let maxWeeks = 0;
    for (const sk of sessionKeys) {
      const wks = computeSessionWeeks(sk, sessions[sk]);
      const schoolWks = wks.filter(w => !w.isBreak);
      sessionWeeksMap[sk] = schoolWks;
      if (schoolWks.length > maxWeeks) maxWeeks = schoolWks.length;
    }

    // Count tests passed per session per week
    const weeklyTestsPassed = {};
    const weeklyTestsTaken = {};
    for (const sk of sessionKeys) {
      weeklyTestsPassed[sk] = {};
      weeklyTestsTaken[sk] = {};
      const wks = sessionWeeksMap[sk];
      for (const w of wks) {
        weeklyTestsPassed[sk][w.key] = 0;
        weeklyTestsTaken[sk][w.key] = 0;
      }
      for (const t of allTests) {
        for (const w of wks) {
          if (t.date >= w.start && t.date <= w.end) {
            weeklyTestsTaken[sk][w.key]++;
            if (t.passed) weeklyTestsPassed[sk][w.key]++;
            break;
          }
        }
      }
    }

    // Build comparison table
    let weekCompareHtml = `
      <h3 style="margin-top:16px;margin-bottom:8px">Week-by-Week Tests Passed — All Sessions</h3>
      <table class="metrics-table" style="margin-bottom:20px">
        <tr><th>Week</th>${sessionKeys.map(sk => `<th>${esc(sessions[sk].label || sk)}</th>`).join("")}</tr>`;
    for (let i = 0; i < maxWeeks; i++) {
      const wkLabel = `Wk${i + 1}`;
      weekCompareHtml += `<tr>
        <td>${wkLabel}</td>
        ${sessionKeys.map(sk => {
          const wks = sessionWeeksMap[sk];
          const w = wks[i];
          if (!w) return `<td style="color:var(--text-muted)">—</td>`;
          const passed = weeklyTestsPassed[sk][w.key] || 0;
          const taken = weeklyTestsTaken[sk][w.key] || 0;
          return `<td>${passed} / ${taken}</td>`;
        }).join("")}
      </tr>`;
    }
    // Totals row
    weekCompareHtml += `<tr style="font-weight:700;border-top:2px solid var(--border)">
      <td>Total</td>
      ${sessionKeys.map(sk => {
        const wks = sessionWeeksMap[sk];
        const totalP = wks.reduce((s, w) => s + (weeklyTestsPassed[sk][w.key] || 0), 0);
        const totalT = wks.reduce((s, w) => s + (weeklyTestsTaken[sk][w.key] || 0), 0);
        return `<td>${totalP} / ${totalT}</td>`;
      }).join("")}
    </tr></table>`;

    let html = `
      <h2 style="margin-bottom:8px">${esc(sess.label || currentSession)} Test Results</h2>
      <div class="tr-summary">
        <span class="tr-stat"><strong>${totalTests}</strong> tests taken</span>
        <span class="tr-stat green"><strong>${totalPassed}</strong> passed (${passRate}%)</span>
        <span class="tr-stat red"><strong>${totalFailed}</strong> failed</span>
        <span class="tr-stat"><strong>${uniqueStudents}</strong> students tested</span>
      </div>
      ${weekCompareHtml}
      <div class="tr-filters">
        <input type="text" id="tr-search" class="search-input" placeholder="Search by student name or test..." autocomplete="off" style="max-width:320px">
        <select id="tr-campus" class="dropdown">
          <option value="all">All Campuses</option>
          ${campuses.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("")}
        </select>
        <select id="tr-type" class="dropdown">
          <option value="all">All Types</option>
          ${testTypes.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join("")}
        </select>
        <select id="tr-result" class="dropdown">
          <option value="all">All Results</option>
          <option value="passed">Passed</option>
          <option value="failed">Failed</option>
        </select>
        <span class="tr-count" id="tr-count">${totalTests} results</span>
      </div>
      <div id="tr-table-wrap">
    `;

    // Build grouped-by-date tables
    for (const date of sortedDates) {
      const dateRows = byDate[date];
      const datePassed = dateRows.filter((r) => r.passed).length;
      html += `
        <div class="tr-date-group" data-date="${date}">
          <div class="tr-date-header">
            <span class="tr-date">${formatDateFull(date)}</span>
            <span class="tr-date-stats">${dateRows.length} tests &middot; ${datePassed} passed</span>
          </div>
          <table class="metrics-table tr-table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Campus</th>
                <th>Level</th>
                <th>HMG</th>
                <th>EG</th>
                <th>Test</th>
                <th>Type</th>
                <th>Score</th>
                <th>Questions</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
      `;
      for (const r of dateRows) {
        const scoreCls = r.passed ? "score-pass" : "score-fail";
        const resultLabel = r.passed ? "PASSED" : "FAILED";
        const questions = r.total_questions
          ? `${r.correct_questions || 0}/${r.total_questions}`
          : "-";
        html += `<tr class="tr-row" data-campus="${esc(r.campus)}" data-type="${esc(r.test_type)}" data-result="${r.passed ? "passed" : "failed"}" data-search="${esc((r.name + " " + r.email + " " + r.test_name).toLowerCase())}">
          <td><strong>${esc(r.name)}</strong><br><span class="tr-email">${esc(r.email)}</span></td>
          <td>${esc(r.campus)}</td>
          <td>${esc(r.level)}</td>
          <td>G${r.hmg}</td>
          <td>${r.effective_grade ? `G${r.effective_grade}` : "-"}</td>
          <td>${esc(r.test_name)}</td>
          <td><span class="tr-type-badge ${r.raw_type === "test out" ? "test-out" : r.raw_type === "placement" ? "placement" : "eoc"}">${esc(r.test_type)}</span></td>
          <td class="${scoreCls}">${r.score}%</td>
          <td>${questions}</td>
          <td><span class="${scoreCls}">${resultLabel}</span></td>
        </tr>`;
      }
      html += `</tbody></table></div>`;
    }

    html += `</div>`;
    container.innerHTML = html;

    // Wire up filters
    function applyTrFilters() {
      const f = trFilters;
      let visibleCount = 0;
      const dateGroups = container.querySelectorAll(".tr-date-group");

      dateGroups.forEach((group) => {
        const trs = group.querySelectorAll(".tr-row");
        let groupVisible = 0;
        trs.forEach((tr) => {
          let show = true;
          if (f.campus !== "all" && tr.dataset.campus !== f.campus) show = false;
          if (f.type !== "all" && tr.dataset.type !== f.type) show = false;
          if (f.result !== "all" && tr.dataset.result !== f.result) show = false;
          if (f.search && !tr.dataset.search.includes(f.search)) show = false;
          tr.classList.toggle("hidden", !show);
          if (show) { visibleCount++; groupVisible++; }
        });
        group.classList.toggle("hidden", groupVisible === 0);

        // Update date header stats
        const statsEl = group.querySelector(".tr-date-stats");
        if (statsEl && groupVisible > 0) {
          const visiblePassed = [...trs].filter((tr) => !tr.classList.contains("hidden") && tr.dataset.result === "passed").length;
          statsEl.textContent = `${groupVisible} tests \u00b7 ${visiblePassed} passed`;
        }
      });

      document.getElementById("tr-count").textContent =
        visibleCount === totalTests ? `${totalTests} results` : `${visibleCount} of ${totalTests} results`;
    }

    document.getElementById("tr-campus").addEventListener("change", (e) => {
      trFilters.campus = e.target.value;
      applyTrFilters();
    });
    document.getElementById("tr-type").addEventListener("change", (e) => {
      trFilters.type = e.target.value;
      applyTrFilters();
    });
    document.getElementById("tr-result").addEventListener("change", (e) => {
      trFilters.result = e.target.value;
      applyTrFilters();
    });

    let trTimer;
    document.getElementById("tr-search").addEventListener("input", (e) => {
      clearTimeout(trTimer);
      trTimer = setTimeout(() => {
        trFilters.search = e.target.value.toLowerCase().trim();
        applyTrFilters();
      }, 200);
    });
  }

  // ── Testing Loops page ──────────────────────────────────────────────
  let testingLoopsRendered = false;

  async function loadLoopData() {
    if (LOOP_DATA) return LOOP_DATA;
    try {
      const resp = await fetch("loop_data.json");
      if (!resp.ok) return null;
      LOOP_DATA = await resp.json();
      return LOOP_DATA;
    } catch { return null; }
  }

  // ── Test Analysis (separate page) ───────────────────────────────────

  let testAnalysisRendered = false;

  function renderTestAnalysis() {
    if (testAnalysisRendered) return;
    testAnalysisRendered = true;

    const container = document.getElementById("test-analysis-container");
    const allStudents = studentsForGroup("timeback");
    const sessions = DATA.all_sessions || {};
    const sessionOrder = Object.keys(sessions).sort();

    function getSession(dateStr) {
      if (!dateStr) return null;
      const d = dateStr.slice(0, 10);
      for (const sn of sessionOrder) {
        if (d >= sessions[sn].start && d <= sessions[sn].end) return sn;
      }
      return null;
    }

    function extractGrade(name) {
      const m = name.match(/G(\d+)/);
      return m ? parseInt(m[1]) : null;
    }

    // Gather all EoC and Test-Out tests
    const allEoC = [];
    const allTO = [];
    for (const s of allStudents) {
      for (const t of (s.all_tests || [])) {
        const tt = (t.test_type || "").toLowerCase();
        const entry = { ...t, _email: s.email, _name: s.name, _grade: extractGrade(t.name || "") };
        if (tt === "end of course") allEoC.push(entry);
        else if (tt === "test out") allTO.push(entry);
      }
    }

    // Group by student+grade (EoC)
    const sg = {};
    for (const t of allEoC) {
      if (!t._grade) continue;
      const key = t._email + "|" + t._grade;
      if (!sg[key]) sg[key] = { email: t._email, name: t._name, grade: t._grade, tests: [] };
      sg[key].tests.push(t);
    }
    for (const key in sg) {
      sg[key].tests.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    }

    // Group by student+grade (Test-Outs)
    const sgTO = {};
    for (const t of allTO) {
      if (!t._grade) continue;
      const key = t._email + "|" + t._grade;
      if (!sgTO[key]) sgTO[key] = { email: t._email, name: t._name, grade: t._grade, tests: [] };
      sgTO[key].tests.push(t);
    }
    for (const key in sgTO) {
      sgTO[key].tests.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    }

    // Determine student cohort (session of first-ever test)
    const studentCohort = {};
    for (const s of allStudents) {
      const tests = (s.all_tests || []).slice().sort((a, b) => (a.date || "").localeCompare(b.date || ""));
      if (tests.length > 0) {
        const sess = getSession(tests[0].date);
        if (sess) studentCohort[s.email] = sess;
      }
    }

    // Helper: compute metrics for a set of student-grade groups
    function computeMetrics(groups) {
      const firstAttempts = [];
      const attemptsToPass = [];
      let stillInProgress = 0;
      let totalAttempts = 0;
      let totalPassed = 0;

      for (const key in groups) {
        const g = groups[key];
        totalAttempts += g.tests.length;
        firstAttempts.push(g.tests[0]);
        let found = false;
        for (let i = 0; i < g.tests.length; i++) {
          if ((g.tests[i].score || 0) >= 90) {
            attemptsToPass.push(i + 1);
            totalPassed += 1;
            found = true;
            break;
          }
        }
        if (!found) stillInProgress++;
      }

      const firstPassed = firstAttempts.filter(t => (t.score || 0) >= 90).length;
      const totalGroups = Object.keys(groups).length;
      const avgAttempts = attemptsToPass.length > 0
        ? (attemptsToPass.reduce((a, b) => a + b, 0) / attemptsToPass.length)
        : 0;
      const median = attemptsToPass.length > 0
        ? (() => { const s = attemptsToPass.slice().sort((a,b) => a-b); const m = Math.floor(s.length/2); return s.length % 2 ? s[m] : (s[m-1]+s[m])/2; })()
        : 0;

      // Distribution
      const dist = {};
      for (const a of attemptsToPass) {
        const bucket = a >= 5 ? "5+" : String(a);
        dist[bucket] = (dist[bucket] || 0) + 1;
      }

      return {
        totalGroups, totalAttempts, totalPassed, stillInProgress,
        firstAttemptRate: totalGroups > 0 ? (100 * firstPassed / totalGroups) : 0,
        firstPassed, avgAttempts, median, dist, attemptsToPass,
        passRate: totalAttempts > 0 ? (100 * totalPassed / totalAttempts) : 0,
      };
    }

    // ── Section 1: Overall Snapshot ──
    const overall = computeMetrics(sg);
    const overallTO = computeMetrics(sgTO);

    let html = `<h2 style="margin-bottom:16px">Writing Test Analysis</h2>
      <div style="font-size:0.82rem;color:var(--text-muted);margin-bottom:20px">
        Based on ${allEoC.length} End of Course tests and ${allTO.length} Test-Outs across ${allStudents.length} students
        &middot; Pass threshold: 90%
        <br>A "student-grade combo" is one student's attempts at one grade level (e.g., Student A attempting G4). "First-Attempt Pass Rate" is the % of student-grade combos that passed on the very first try. "Still In Progress" means the student hasn't passed that grade yet.
      </div>`;

    html += `<h3 style="margin-bottom:8px">End of Course Tests</h3>
    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-value blue">${allEoC.length}</div>
        <div class="metric-label">Total EoC Tests</div>
        <div class="metric-sub">${overall.totalGroups} student-grade combos</div>
      </div>
      <div class="metric-card">
        <div class="metric-value ${overall.firstAttemptRate >= 40 ? "green" : overall.firstAttemptRate >= 25 ? "orange" : "red"}">${overall.firstAttemptRate.toFixed(1)}%</div>
        <div class="metric-label">First-Attempt Pass Rate</div>
        <div class="metric-sub">${overall.firstPassed} / ${overall.totalGroups}</div>
      </div>
      <div class="metric-card">
        <div class="metric-value blue">${overall.avgAttempts.toFixed(2)}</div>
        <div class="metric-label">Avg Attempts to Pass</div>
        <div class="metric-sub">Median: ${overall.median}</div>
      </div>
      <div class="metric-card">
        <div class="metric-value ${overall.stillInProgress > 50 ? "red" : "orange"}">${overall.stillInProgress}</div>
        <div class="metric-label">Still In Progress</div>
        <div class="metric-sub">${overall.totalPassed} grades passed</div>
      </div>
    </div>`;

    html += `<h3 style="margin:20px 0 8px">Test-Outs</h3>
    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-value blue">${allTO.length}</div>
        <div class="metric-label">Total Test-Outs</div>
        <div class="metric-sub">${overallTO.totalGroups} student-grade combos</div>
      </div>
      <div class="metric-card">
        <div class="metric-value ${overallTO.totalGroups > 0 && (100 * overallTO.totalPassed / overallTO.totalGroups) >= 40 ? "green" : (100 * overallTO.totalPassed / overallTO.totalGroups) >= 25 ? "orange" : "red"}">${overallTO.totalGroups > 0 ? (100 * overallTO.totalPassed / overallTO.totalGroups).toFixed(1) : "0.0"}%</div>
        <div class="metric-label">Pass Rate</div>
        <div class="metric-sub">${overallTO.totalPassed} / ${overallTO.totalGroups}</div>
      </div>
      <div class="metric-card">
        <div class="metric-value green">${overallTO.totalPassed}</div>
        <div class="metric-label">Passed</div>
      </div>
      <div class="metric-card">
        <div class="metric-value ${(overallTO.totalGroups - overallTO.totalPassed) > 0 ? "red" : "green"}">${overallTO.totalGroups - overallTO.totalPassed}</div>
        <div class="metric-label">Failed</div>
      </div>
    </div>`;

    // ── Section 2: By Grade Level ──
    html += `<div class="metrics-section"><h2>By Grade Level</h2>
      <p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:12px">
        Breaks down test performance by grade level (G3–G8). Shows how many student-grade combos attempted each grade, the overall pass rate across all attempts, and how many attempts it typically takes to pass. EoC and Test-Out results shown separately.
      </p>
      <h3>End of Course</h3>
      <table class="metrics-table">
        <tr><th>Grade</th><th>Tests</th><th>Student-Grade Combos</th><th>Pass Rate (All)</th><th>First-Attempt Pass Rate</th><th>Avg Attempts to Pass</th><th>Median</th><th>Still In Progress</th></tr>`;

    for (let g = 3; g <= 8; g++) {
      const gradeGroups = {};
      for (const key in sg) {
        if (sg[key].grade === g) gradeGroups[key] = sg[key];
      }
      const m = computeMetrics(gradeGroups);
      if (m.totalGroups === 0) continue;
      html += `<tr>
        <td><strong>G${g}</strong></td>
        <td>${m.totalAttempts}</td>
        <td>${m.totalGroups}</td>
        <td>${m.passRate.toFixed(1)}%</td>
        <td class="${m.firstAttemptRate >= 40 ? "score-pass" : "score-fail"}">${m.firstAttemptRate.toFixed(1)}%</td>
        <td>${m.avgAttempts.toFixed(2)}</td>
        <td>${m.median}</td>
        <td>${m.stillInProgress}</td>
      </tr>`;
    }
    html += `</table>`;

    html += `<h3 style="margin-top:16px">Test-Outs</h3>
      <table class="metrics-table">
        <tr><th>Grade</th><th>Tests</th><th>Pass Rate</th><th>Passed</th><th>Failed</th></tr>`;

    for (let g = 3; g <= 8; g++) {
      const gradeGroups = {};
      for (const key in sgTO) {
        if (sgTO[key].grade === g) gradeGroups[key] = sgTO[key];
      }
      const m = computeMetrics(gradeGroups);
      if (m.totalGroups === 0) continue;
      const passRate = m.totalGroups > 0 ? (100 * m.totalPassed / m.totalGroups).toFixed(1) : "0.0";
      html += `<tr>
        <td><strong>G${g}</strong></td>
        <td>${m.totalGroups}</td>
        <td class="${passRate >= 40 ? "score-pass" : "score-fail"}">${passRate}%</td>
        <td>${m.totalPassed}</td>
        <td>${m.totalGroups - m.totalPassed}</td>
      </tr>`;
    }
    html += `</table></div>`;

    // ── Section 3: By Session (when test was taken) ──
    const renderSessionTable = (label, tests, groups, singleAttempt) => {
      const headers = singleAttempt
        ? `<tr><th>Session</th><th>Tests</th><th>Pass Rate</th><th>Passed</th><th>Failed</th></tr>`
        : `<tr><th>Session</th><th>Tests Taken</th><th>All-Attempt Pass Rate</th><th>First-Attempt Pass Rate</th><th>Grades Passed</th><th>Avg Attempts of Passes</th></tr>`;
      let h = `<h3${label === "Test-Outs" ? ' style="margin-top:16px"' : ""}>${label}</h3>
        <table class="metrics-table">${headers}`;

      for (const sn of sessionOrder) {
        const sessTests = tests.filter(t => getSession(t.date) === sn);
        if (sessTests.length === 0) continue;
        const sessPassed = sessTests.filter(t => (t.score || 0) >= 90).length;
        const sessPassRate = sessTests.length > 0 ? (100 * sessPassed / sessTests.length) : 0;

        if (singleAttempt) {
          h += `<tr>
            <td><strong>${esc(sessions[sn].label || sn)}</strong></td>
            <td>${sessTests.length}</td>
            <td class="${sessPassRate >= 40 ? "score-pass" : "score-fail"}">${sessPassRate.toFixed(1)}%</td>
            <td>${sessPassed}</td>
            <td>${sessTests.length - sessPassed}</td>
          </tr>`;
        } else {
          const sessFirstGroups = {};
          for (const key in groups) {
            const first = groups[key].tests[0];
            if (getSession(first.date) === sn) sessFirstGroups[key] = groups[key];
          }
          const fMetrics = computeMetrics(sessFirstGroups);

          const sessPassAttempts = [];
          for (const key in groups) {
            for (let i = 0; i < groups[key].tests.length; i++) {
              if ((groups[key].tests[i].score || 0) >= 90 && getSession(groups[key].tests[i].date) === sn) {
                sessPassAttempts.push(i + 1);
                break;
              }
            }
          }
          const avgPassAttempts = sessPassAttempts.length > 0
            ? (sessPassAttempts.reduce((a, b) => a + b, 0) / sessPassAttempts.length)
            : 0;

          h += `<tr>
            <td><strong>${esc(sessions[sn].label || sn)}</strong></td>
            <td>${sessTests.length}</td>
            <td>${sessPassRate.toFixed(1)}%</td>
            <td class="${fMetrics.firstAttemptRate >= 40 ? "score-pass" : "score-fail"}">${fMetrics.firstAttemptRate.toFixed(1)}% <span style="font-weight:400;color:var(--text-muted)">(${fMetrics.firstPassed}/${fMetrics.totalGroups})</span></td>
            <td>${sessPassAttempts.length}</td>
            <td>${avgPassAttempts.toFixed(2)}</td>
          </tr>`;
        }
      }
      h += `</table>`;
      return h;
    };

    html += `<div class="metrics-section"><h2>By Session (When Test Was Taken)</h2>
      <p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:12px">
        Groups tests by which session they were taken in, regardless of when the student started. "First-Attempt Pass Rate" here only counts student-grade combos whose first-ever attempt at that grade happened in this session. "Grades Passed" is the number of grade levels passed during this session (including retakes that started earlier).
      </p>`;
    html += renderSessionTable("End of Course", allEoC, sg, false);
    html += renderSessionTable("Test-Outs", allTO, sgTO, true);
    html += `</div>`;

    // ── Section 3b: By Date-Based Cohort (matching spreadsheet) ──
    const dateCohorts = [
      { name: "Cohort 1 — Before Updates", start: "2025-08-01", end: "2025-10-14" },
      { name: "Cohort 2 — After Updates", start: "2025-10-15", end: "2026-04-17" },
    ];

    const renderDateCohortTable = (label, tests, groups, singleAttempt) => {
      const fmtRate = (p, a) => a > 0 ? `${(100*p/a).toFixed(1)}%` : "-";
      const headerCols = singleAttempt
        ? `<tr><th>Cohort</th><th>Dates</th><th>G3</th><th>G4</th><th>G5</th><th>G6</th><th>G7</th><th>G8</th><th>Total</th></tr>`
        : `<tr><th>Cohort</th><th>Dates</th><th>Metric</th><th>G3</th><th>G4</th><th>G5</th><th>G6</th><th>G7</th><th>G8</th><th>Total</th></tr>`;
      let h = `<h3${label === "Test-Outs" ? ' style="margin-top:16px"' : ""}>${label}</h3>
        <table class="metrics-table">${headerCols}`;

      for (const dc of dateCohorts) {
        const byGrade = {};
        for (let g = 3; g <= 8; g++) byGrade[g] = { attempted: 0, passed: 0, firstAtt: 0, firstPass: 0 };
        let totalAtt = 0, totalPass = 0, totalFirstAtt = 0, totalFirstPass = 0;

        for (const t of tests) {
          const d = (t.date || "").slice(0, 10);
          if (d < dc.start || d > dc.end) continue;
          const g = t._grade;
          if (!g || g < 3 || g > 8) continue;
          byGrade[g].attempted++;
          totalAtt++;
          if ((t.score || 0) >= 90) { byGrade[g].passed++; totalPass++; }
        }

        if (!singleAttempt) {
          for (const key in groups) {
            const first = groups[key].tests[0];
            const d = (first.date || "").slice(0, 10);
            if (d < dc.start || d > dc.end) continue;
            const g = groups[key].grade;
            if (g < 3 || g > 8) continue;
            byGrade[g].firstAtt++;
            totalFirstAtt++;
            if ((first.score || 0) >= 90) { byGrade[g].firstPass++; totalFirstPass++; }
          }
        }

        if (totalAtt === 0) continue;
        const dateLabel = `${dc.start.slice(5)} – ${dc.end.slice(5)}`;

        if (singleAttempt) {
          h += `<tr><td><strong>${esc(dc.name)}</strong></td><td style="font-size:0.8rem">${dateLabel}</td>`;
          for (let g = 3; g <= 8; g++) {
            const rate = fmtRate(byGrade[g].passed, byGrade[g].attempted);
            const cls = byGrade[g].attempted > 0 ? (byGrade[g].passed / byGrade[g].attempted >= 0.4 ? "score-pass" : "score-fail") : "";
            h += `<td class="${cls}">${rate} <span style="font-weight:400;color:var(--text-muted);font-size:0.75rem">(${byGrade[g].passed}/${byGrade[g].attempted})</span></td>`;
          }
          const totalRate = fmtRate(totalPass, totalAtt);
          const totalCls = totalPass / totalAtt >= 0.4 ? "score-pass" : "score-fail";
          h += `<td class="${totalCls}"><strong>${totalRate}</strong> <span style="font-weight:400;color:var(--text-muted);font-size:0.75rem">(${totalPass}/${totalAtt})</span></td></tr>`;
        } else {
          h += `<tr><td rowspan="2" style="vertical-align:middle"><strong>${esc(dc.name)}</strong></td><td rowspan="2" style="vertical-align:middle;font-size:0.8rem">${dateLabel}</td>`;
          h += `<td style="font-size:0.75rem;color:var(--text-muted);padding:2px 4px">All Attempts</td>`;
          for (let g = 3; g <= 8; g++) {
            const rate = fmtRate(byGrade[g].passed, byGrade[g].attempted);
            const cls = byGrade[g].attempted > 0 ? (byGrade[g].passed / byGrade[g].attempted >= 0.4 ? "score-pass" : "score-fail") : "";
            h += `<td class="${cls}">${rate} <span style="font-weight:400;color:var(--text-muted);font-size:0.75rem">(${byGrade[g].passed}/${byGrade[g].attempted})</span></td>`;
          }
          const totalRate = fmtRate(totalPass, totalAtt);
          const totalCls = totalPass / totalAtt >= 0.4 ? "score-pass" : "score-fail";
          h += `<td class="${totalCls}"><strong>${totalRate}</strong> <span style="font-weight:400;color:var(--text-muted);font-size:0.75rem">(${totalPass}/${totalAtt})</span></td></tr>`;

          h += `<tr><td style="font-size:0.75rem;color:var(--text-muted);padding:2px 4px">1st Attempt</td>`;
          for (let g = 3; g <= 8; g++) {
            const rate = fmtRate(byGrade[g].firstPass, byGrade[g].firstAtt);
            const cls = byGrade[g].firstAtt > 0 ? (byGrade[g].firstPass / byGrade[g].firstAtt >= 0.4 ? "score-pass" : "score-fail") : "";
            h += `<td class="${cls}">${rate} <span style="font-weight:400;color:var(--text-muted);font-size:0.75rem">(${byGrade[g].firstPass}/${byGrade[g].firstAtt})</span></td>`;
          }
          const totalFirstRate = fmtRate(totalFirstPass, totalFirstAtt);
          const totalFirstCls = totalFirstAtt > 0 && totalFirstPass / totalFirstAtt >= 0.4 ? "score-pass" : "score-fail";
          h += `<td class="${totalFirstCls}"><strong>${totalFirstRate}</strong> <span style="font-weight:400;color:var(--text-muted);font-size:0.75rem">(${totalFirstPass}/${totalFirstAtt})</span></td></tr>`;
        }
      }

      h += `</table>`;
      return h;
    };

    html += `<div class="metrics-section"><h2>Cohorts: Before and After Updates</h2>
      <p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:12px">
        Groups tests by date range, matching the cohort definitions from the AlphaWrite Tests Graded spreadsheet. Cohort 1 covers tests before AlphaWrite updates (Aug 1 – Oct 14). Cohort 2 covers tests after updates (Oct 15 onward). EoC shows two rows per cohort: "All Attempts" and "1st Attempt". Test-Outs show a single pass rate since each student only gets one attempt per grade.
      </p>`;
    html += renderDateCohortTable("End of Course", allEoC, sg, false);
    html += renderDateCohortTable("Test-Outs", allTO, sgTO, true);
    html += `</div>`;

    // ── Section 4: By Cohort ──
    const renderStudentCohortTable = (label, groups, singleAttempt) => {
      const headers = singleAttempt
        ? `<tr><th>Cohort</th><th>Students</th><th>Tests</th><th>Pass Rate</th><th>Passed</th><th>Failed</th></tr>`
        : `<tr><th>Cohort</th><th>Students</th><th>Grades Attempted</th><th>Grades Passed</th><th>First-Attempt Pass Rate</th><th>Avg Attempts to Pass</th><th>Median</th><th>Still In Progress</th></tr>`;
      let h = `<h3${label === "Test-Outs" ? ' style="margin-top:16px"' : ""}>${label}</h3>
        <table class="metrics-table">${headers}`;

      for (const sn of sessionOrder) {
        const cohortEmails = new Set();
        for (const email in studentCohort) {
          if (studentCohort[email] === sn) cohortEmails.add(email);
        }
        const cohortGroups = {};
        for (const key in groups) {
          if (cohortEmails.has(groups[key].email)) cohortGroups[key] = groups[key];
        }
        const m = computeMetrics(cohortGroups);
        if (cohortEmails.size === 0) continue;

        if (singleAttempt) {
          const passRate = m.totalGroups > 0 ? (100 * m.totalPassed / m.totalGroups).toFixed(1) : "0.0";
          h += `<tr>
            <td><strong>${esc(sessions[sn].label || sn)} Cohort</strong></td>
            <td>${cohortEmails.size}</td>
            <td>${m.totalGroups}</td>
            <td class="${passRate >= 40 ? "score-pass" : "score-fail"}">${passRate}%</td>
            <td>${m.totalPassed}</td>
            <td>${m.totalGroups - m.totalPassed}</td>
          </tr>`;
        } else {
          h += `<tr>
            <td><strong>${esc(sessions[sn].label || sn)} Cohort</strong></td>
            <td>${cohortEmails.size}</td>
            <td>${m.totalGroups}</td>
            <td>${m.totalPassed}</td>
            <td class="${m.firstAttemptRate >= 40 ? "score-pass" : "score-fail"}">${m.firstAttemptRate.toFixed(1)}%</td>
            <td>${m.avgAttempts.toFixed(2)}</td>
            <td>${m.median}</td>
            <td>${m.stillInProgress}</td>
          </tr>`;
        }
      }
      h += `</table>`;
      return h;
    };

    html += `<div class="metrics-section"><h2>By Student Cohort (Session of First Test)</h2>
      <p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:12px">
        Students are grouped into cohorts based on which session they took their very first test (any test type, not just EoC). This shows how each "generation" of students performs over time. Earlier cohorts have had more time in the system and more opportunities to attempt and pass grades.
      </p>`;
    html += renderStudentCohortTable("End of Course", sg, false);
    html += renderStudentCohortTable("Test-Outs", sgTO, true);
    html += `</div>`;

    // ── Section 5: Cohort Journey ──
    function buildCohortJourney(groups) {
      const journeys = [];
      for (const cohortSn of sessionOrder) {
        const cohortEmails = new Set();
        for (const email in studentCohort) {
          if (studentCohort[email] === cohortSn) cohortEmails.add(email);
        }
        if (cohortEmails.size === 0) continue;

        const cohortGroups = {};
        for (const key in groups) {
          if (cohortEmails.has(groups[key].email)) cohortGroups[key] = groups[key];
        }

        const sessData = [];
        const studentPassedGrades = {};
        for (const email of cohortEmails) studentPassedGrades[email] = new Set();

        let cumGradesPassed = 0;
        let cumStudentsWithPass = new Set();

        for (const sessSn of sessionOrder) {
          let attempts = 0, passed = 0;
          const scores = [];
          const testedEmails = new Set();
          const gradesTested = {};
          const gradesPassed = {};

          for (const key in cohortGroups) {
            const g = cohortGroups[key];
            for (const t of g.tests) {
              if (getSession(t.date) !== sessSn) continue;
              attempts++;
              scores.push(t.score || 0);
              testedEmails.add(g.email);
              const gr = g.grade;
              gradesTested[gr] = (gradesTested[gr] || 0) + 1;
              if ((t.score || 0) >= 90) {
                passed++;
                gradesPassed[gr] = (gradesPassed[gr] || 0) + 1;
                studentPassedGrades[g.email].add(gr);
              }
            }
          }

          // Update cumulative counters
          cumGradesPassed = 0;
          cumStudentsWithPass = new Set();
          for (const email of cohortEmails) {
            const pg = studentPassedGrades[email];
            cumGradesPassed += pg.size;
            if (pg.size > 0) cumStudentsWithPass.add(email);
          }

          // Student status
          const completedAll = new Set();
          const activelyTesting = new Set();
          const notYetTested = new Set();
          // Stuck count: students with 3+ cumulative attempts on any single grade without passing
          let stuckCount = 0;
          const stuckEmails = new Set();

          for (const email of cohortEmails) {
            let hasTested = false;
            let allPassed = true;
            for (const key in cohortGroups) {
              if (cohortGroups[key].email !== email) continue;
              const testsUpToNow = cohortGroups[key].tests.filter(t => {
                const s = getSession(t.date);
                return s && sessionOrder.indexOf(s) <= sessionOrder.indexOf(sessSn);
              });
              if (testsUpToNow.length > 0) {
                hasTested = true;
                const didPass = testsUpToNow.some(t => (t.score || 0) >= 90);
                if (!didPass) {
                  allPassed = false;
                  if (testsUpToNow.length >= 3) stuckEmails.add(email);
                }
              }
            }
            if (!hasTested) {
              if (sessionOrder.indexOf(sessSn) >= sessionOrder.indexOf(cohortSn)) notYetTested.add(email);
            } else if (allPassed) {
              completedAll.add(email);
            } else {
              activelyTesting.add(email);
            }
          }
          stuckCount = stuckEmails.size;

          const gradeKeys = Object.keys(gradesTested).map(Number).sort((a,b) => a-b);
          const avgScore = scores.length > 0 ? (scores.reduce((a,b) => a+b, 0) / scores.length) : null;

          // Median grade tested this session
          let medianGrade = null;
          if (gradeKeys.length > 0) {
            const allGrades = [];
            for (const g of gradeKeys) {
              for (let i = 0; i < gradesTested[g]; i++) allGrades.push(g);
            }
            allGrades.sort((a,b) => a-b);
            const mid = Math.floor(allGrades.length / 2);
            medianGrade = allGrades.length % 2 ? allGrades[mid] : (allGrades[mid-1] + allGrades[mid]) / 2;
          }

          sessData.push({
            session: sessSn,
            label: sessions[sessSn].label || sessSn,
            attempts, passed, scores, avgScore,
            testedStudents: testedEmails.size,
            activelyTesting: activelyTesting.size,
            completedAll: completedAll.size,
            notYetTested: notYetTested.size,
            stuckCount,
            gradesTested, gradesPassed, gradeKeys,
            medianGrade,
            cumGradesPassed,
            cumStudentsWithPass: cumStudentsWithPass.size,
          });
        }

        journeys.push({
          cohortSn,
          label: sessions[cohortSn].label || cohortSn,
          totalStudents: cohortEmails.size,
          sessData,
        });
      }
      return journeys;
    }

    // Trend arrow helper
    const trend = (curr, prev) => {
      if (prev === null || curr === null) return "";
      const diff = curr - prev;
      if (Math.abs(diff) < 0.5) return ` <span style="color:var(--text-muted)">→</span>`;
      return diff > 0
        ? ` <span style="color:#22c55e">↑</span>`
        : ` <span style="color:#ef4444">↓</span>`;
    };

    const renderCohortJourney = (label, groups, singleAttempt) => {
      const journeys = buildCohortJourney(groups);
      let h = `<h3${label === "Test-Outs" ? ' style="margin-top:16px"' : ""}>${label}</h3>`;

      for (const j of journeys) {
        const startIdx = sessionOrder.indexOf(j.cohortSn);
        const relevantSess = j.sessData.filter((_, i) => i >= startIdx);
        if (relevantSess.length === 0) continue;

        h += `<h4 style="margin:16px 0 6px;font-size:0.95rem">${esc(j.label)} Cohort <span style="font-weight:400;color:var(--text-muted)">(${j.totalStudents} students)</span></h4>`;
        h += `<table class="metrics-table">`;

        // Header
        h += `<tr><th style="min-width:150px">Metric</th>`;
        for (const sd of relevantSess) h += `<th>${esc(sd.label)}</th>`;
        h += `</tr>`;

        // Row: Pass Rate + trend
        h += `<tr><td><strong>Pass Rate</strong></td>`;
        for (let i = 0; i < relevantSess.length; i++) {
          const sd = relevantSess[i];
          if (sd.attempts === 0) { h += `<td style="color:var(--text-muted)">—</td>`; continue; }
          const rate = 100 * sd.passed / sd.attempts;
          const prevRate = i > 0 && relevantSess[i-1].attempts > 0 ? 100 * relevantSess[i-1].passed / relevantSess[i-1].attempts : null;
          const cls = rate >= 40 ? "score-pass" : rate > 0 ? "" : "score-fail";
          h += `<td class="${cls}">${sd.passed}/${sd.attempts} (${rate.toFixed(0)}%)${trend(rate, prevRate)}</td>`;
        }
        h += `</tr>`;

        // Row: Avg Score + trend
        h += `<tr><td><strong>Avg Score</strong></td>`;
        for (let i = 0; i < relevantSess.length; i++) {
          const sd = relevantSess[i];
          if (sd.avgScore === null) { h += `<td style="color:var(--text-muted)">—</td>`; continue; }
          const prevAvg = i > 0 ? relevantSess[i-1].avgScore : null;
          const cls = sd.avgScore >= 90 ? "score-pass" : sd.avgScore >= 75 ? "" : "score-fail";
          h += `<td class="${cls}">${sd.avgScore.toFixed(1)}${trend(sd.avgScore, prevAvg)}</td>`;
        }
        h += `</tr>`;

        // Row: Median Grade + trend
        h += `<tr><td><strong>Median Grade</strong></td>`;
        for (let i = 0; i < relevantSess.length; i++) {
          const sd = relevantSess[i];
          if (sd.medianGrade === null) { h += `<td style="color:var(--text-muted)">—</td>`; continue; }
          const prevMed = i > 0 ? relevantSess[i-1].medianGrade : null;
          h += `<td>G${sd.medianGrade % 1 === 0 ? sd.medianGrade : sd.medianGrade.toFixed(1)}${trend(sd.medianGrade, prevMed)}</td>`;
        }
        h += `</tr>`;

        if (!singleAttempt) {
          // Row: Cumulative Progress
          h += `<tr><td><strong>Cumulative Progress</strong></td>`;
          for (const sd of relevantSess) {
            if (sd.cumGradesPassed === 0 && sd.cumStudentsWithPass === 0) { h += `<td style="color:var(--text-muted)">—</td>`; continue; }
            const pctStudents = (100 * sd.cumStudentsWithPass / j.totalStudents).toFixed(0);
            h += `<td>${sd.cumGradesPassed} grades passed<br><span style="font-size:0.75rem;color:var(--text-muted)">${sd.cumStudentsWithPass}/${j.totalStudents} students (${pctStudents}%)</span></td>`;
          }
          h += `</tr>`;

          // Row: Student Status
          h += `<tr><td><strong>Students Testing</strong></td>`;
          for (const sd of relevantSess) {
            if (sd.testedStudents === 0 && sd.activelyTesting === 0) { h += `<td style="color:var(--text-muted)">—</td>`; continue; }
            h += `<td>${sd.testedStudents} tested<br><span style="font-size:0.75rem;color:var(--text-muted)">${sd.activelyTesting} in progress · ${sd.completedAll} done</span></td>`;
          }
          h += `</tr>`;

          // Row: Stuck (3+ attempts without passing)
          h += `<tr><td><strong>Stuck (3+ attempts)</strong></td>`;
          for (const sd of relevantSess) {
            if (sd.stuckCount === 0) {
              h += sd.attempts > 0 ? `<td class="score-pass">0</td>` : `<td style="color:var(--text-muted)">—</td>`;
              continue;
            }
            const cls = sd.stuckCount >= 5 ? "score-fail" : "";
            h += `<td class="${cls}">${sd.stuckCount} students</td>`;
          }
          h += `</tr>`;

          // Row: Grade Distribution
          h += `<tr><td><strong>Grades Tested</strong></td>`;
          for (const sd of relevantSess) {
            if (sd.gradeKeys.length === 0) { h += `<td style="color:var(--text-muted)">—</td>`; continue; }
            const parts = sd.gradeKeys.map(g => {
              const tested = sd.gradesTested[g] || 0;
              const passed = sd.gradesPassed[g] || 0;
              const cls = tested > 0 && passed/tested >= 0.4 ? "score-pass" : "";
              return `<span class="${cls}">G${g}: ${passed}/${tested}</span>`;
            });
            h += `<td style="font-size:0.8rem;line-height:1.6">${parts.join("<br>")}</td>`;
          }
          h += `</tr>`;
        }

        h += `</table>`;
      }

      // ── Normalized comparison: "Sessions Since Start" ──
      if (!singleAttempt && journeys.length > 1) {
        h += `<h4 style="margin:20px 0 6px;font-size:0.95rem">Cohort Comparison (Normalized by Sessions Since Start)</h4>`;
        const maxSessions = Math.max(...journeys.map(j => {
          const startIdx = sessionOrder.indexOf(j.cohortSn);
          return j.sessData.length - startIdx;
        }));

        // Header
        h += `<table class="metrics-table"><tr><th>Cohort</th><th>Metric</th>`;
        for (let i = 0; i < maxSessions; i++) h += `<th>Session ${i+1}</th>`;
        h += `</tr>`;

        for (const j of journeys) {
          const startIdx = sessionOrder.indexOf(j.cohortSn);
          const relevantSess = j.sessData.slice(startIdx);

          // Pass Rate row
          h += `<tr><td rowspan="3" style="vertical-align:middle"><strong>${esc(j.label)}</strong><br><span style="font-size:0.75rem;color:var(--text-muted)">(${j.totalStudents} students)</span></td>`;
          h += `<td style="font-size:0.8rem">Pass Rate</td>`;
          for (let i = 0; i < maxSessions; i++) {
            const sd = relevantSess[i];
            if (!sd || sd.attempts === 0) { h += `<td style="color:var(--text-muted)">—</td>`; continue; }
            const rate = (100 * sd.passed / sd.attempts).toFixed(0);
            const cls = rate >= 40 ? "score-pass" : rate > 0 ? "" : "score-fail";
            h += `<td class="${cls}">${rate}%</td>`;
          }
          h += `</tr>`;

          // Avg Score row
          h += `<tr><td style="font-size:0.8rem">Avg Score</td>`;
          for (let i = 0; i < maxSessions; i++) {
            const sd = relevantSess[i];
            if (!sd || sd.avgScore === null) { h += `<td style="color:var(--text-muted)">—</td>`; continue; }
            const cls = sd.avgScore >= 90 ? "score-pass" : sd.avgScore >= 75 ? "" : "score-fail";
            h += `<td class="${cls}">${sd.avgScore.toFixed(1)}</td>`;
          }
          h += `</tr>`;

          // Median Grade row
          h += `<tr><td style="font-size:0.8rem">Median Grade</td>`;
          for (let i = 0; i < maxSessions; i++) {
            const sd = relevantSess[i];
            if (!sd || sd.medianGrade === null) { h += `<td style="color:var(--text-muted)">—</td>`; continue; }
            h += `<td>G${sd.medianGrade % 1 === 0 ? sd.medianGrade : sd.medianGrade.toFixed(1)}</td>`;
          }
          h += `</tr>`;
        }

        h += `</table>`;
      }

      return h;
    };

    html += `<div class="metrics-section"><h2>Cohort Journey</h2>
      <p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:12px">
        Tracks each starting cohort through subsequent sessions. For each cohort, shows per-session pass rates, average scores, median grade level, cumulative progress, student status, stuck count (3+ attempts without passing on any grade), and grade-level breakdown. Trend arrows (↑↓→) compare to the prior session. The normalized comparison at the bottom aligns all cohorts by "sessions since start" so you can compare how different cohorts perform at the same stage of their journey.
      </p>`;
    html += renderCohortJourney("End of Course", sg, false);
    html += renderCohortJourney("Test-Outs", sgTO, true);
    html += `</div>`;

    // ── Section 5b: Cohort x Grade Level Matrix ──
    const renderCohortGradeMatrix = (label, groups, singleAttempt) => {
      const grades = [3,4,5,6,7,8];
      const headerCols = singleAttempt
        ? `<tr><th>Starting Cohort</th><th>Students</th>${grades.map(g => `<th>G${g}</th>`).join("")}<th>Total</th></tr>`
        : `<tr><th>Starting Cohort</th><th>Students</th><th>Metric</th>${grades.map(g => `<th>G${g}</th>`).join("")}<th>Total</th></tr>`;
      let h = `<h3${label === "Test-Outs" ? ' style="margin-top:16px"' : ""}>${label}</h3>
        <table class="metrics-table">${headerCols}`;

      for (const cohortSn of sessionOrder) {
        const cohortEmails = new Set();
        for (const email in studentCohort) {
          if (studentCohort[email] === cohortSn) cohortEmails.add(email);
        }
        if (cohortEmails.size === 0) continue;

        // Collect per-grade metrics for this cohort
        const byGrade = {};
        for (const g of grades) byGrade[g] = { attempts: 0, passed: 0, firstAtt: 0, firstPass: 0 };
        let totalAtt = 0, totalPass = 0, totalFirstAtt = 0, totalFirstPass = 0;

        for (const key in groups) {
          if (!cohortEmails.has(groups[key].email)) continue;
          const g = groups[key].grade;
          if (g < 3 || g > 8) continue;
          byGrade[g].attempts++;
          totalAtt++;
          byGrade[g].firstAtt++;
          totalFirstAtt++;
          const first = groups[key].tests[0];
          if ((first.score || 0) >= 90) { byGrade[g].firstPass++; totalFirstPass++; }
          const didPass = groups[key].tests.some(t => (t.score || 0) >= 90);
          if (didPass) { byGrade[g].passed++; totalPass++; }
        }

        if (totalAtt === 0) continue;
        const fmtRate = (p, a) => a > 0 ? `${(100*p/a).toFixed(0)}%` : "—";
        const fmtCell = (p, a) => {
          if (a === 0) return `<td style="color:var(--text-muted)">—</td>`;
          const rate = 100*p/a;
          const cls = rate >= 40 ? "score-pass" : rate > 0 ? "" : "score-fail";
          return `<td class="${cls}">${p}/${a} (${rate.toFixed(0)}%)</td>`;
        };

        const cohortLabel = esc(sessions[cohortSn].label || cohortSn);

        if (singleAttempt) {
          h += `<tr><td><strong>${cohortLabel} Cohort</strong></td><td>${cohortEmails.size}</td>`;
          for (const g of grades) h += fmtCell(byGrade[g].passed, byGrade[g].attempts);
          h += `<td><strong>${totalPass}/${totalAtt} (${fmtRate(totalPass, totalAtt)})</strong></td></tr>`;
        } else {
          // Row 1: Pass rate (student-grade combos that passed)
          h += `<tr><td rowspan="2" style="vertical-align:middle"><strong>${cohortLabel} Cohort</strong></td>`;
          h += `<td rowspan="2" style="vertical-align:middle">${cohortEmails.size}</td>`;
          h += `<td style="font-size:0.75rem;color:var(--text-muted);padding:2px 4px">Pass Rate</td>`;
          for (const g of grades) h += fmtCell(byGrade[g].passed, byGrade[g].attempts);
          h += `<td><strong>${totalPass}/${totalAtt} (${fmtRate(totalPass, totalAtt)})</strong></td></tr>`;
          // Row 2: First-attempt pass rate
          h += `<tr><td style="font-size:0.75rem;color:var(--text-muted);padding:2px 4px">1st Attempt</td>`;
          for (const g of grades) h += fmtCell(byGrade[g].firstPass, byGrade[g].firstAtt);
          h += `<td><strong>${totalFirstPass}/${totalFirstAtt} (${fmtRate(totalFirstPass, totalFirstAtt)})</strong></td></tr>`;
        }
      }

      h += `</table>`;
      return h;
    };

    html += `<div class="metrics-section"><h2>Starting Cohort x Grade Level</h2>
      <p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:12px">
        Shows cumulative school-year-to-date test results for each starting cohort (session of first test) broken down by grade level. "Pass Rate" is the % of student-grade combos that eventually passed. "1st Attempt" is the % that passed on their very first try. Read across a row to see which grades a cohort is testing at and how they perform. Earlier cohorts tend to have progressed to higher grades.
      </p>`;
    html += renderCohortGradeMatrix("End of Course", sg, false);
    html += renderCohortGradeMatrix("Test-Outs", sgTO, true);
    html += `</div>`;

    // ── Section 6: Attempts Distribution ──
    const distRow = (label, metrics) => {
      const total = metrics.attemptsToPass.length;
      if (total === 0) return "";
      const counts = [1,2,3,4].map(n => metrics.attemptsToPass.filter(a => a === n).length);
      counts.push(metrics.attemptsToPass.filter(a => a >= 5).length);
      return `<tr>
        <td><strong>${label}</strong></td>
        ${counts.map((c, i) => {
          const pct = (100 * c / total).toFixed(0);
          const cls = i === 0 ? "score-pass" : "";
          return `<td class="${cls}">${c} (${pct}%)</td>`;
        }).join("")}
        <td>${total}</td>
        <td>${metrics.avgAttempts.toFixed(2)}</td>
        <td>${metrics.median}</td>
      </tr>`;
    };

    const renderDistTable = (label, overallMetrics, groups) => {
      let h = `<h3${label === "Test-Outs" ? ' style="margin-top:16px"' : ""}>${label}</h3>
        <table class="metrics-table">
          <tr><th>Cohort</th><th>1 Attempt</th><th>2 Attempts</th><th>3 Attempts</th><th>4 Attempts</th><th>5+</th><th>Total Passed</th><th>Avg</th><th>Median</th></tr>`;
      h += distRow("Overall", overallMetrics);
      for (const sn of sessionOrder) {
        const cohortEmails = new Set();
        for (const email in studentCohort) {
          if (studentCohort[email] === sn) cohortEmails.add(email);
        }
        const cohortGroups = {};
        for (const key in groups) {
          if (cohortEmails.has(groups[key].email)) cohortGroups[key] = groups[key];
        }
        const m = computeMetrics(cohortGroups);
        h += distRow(`${sessions[sn].label || sn} Cohort`, m);
      }
      h += `</table>`;
      return h;
    };

    html += `<div class="metrics-section"><h2>Attempts Distribution (Grades That Were Passed)</h2>
      <p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:12px">
        For student-grade combos that eventually passed, shows how many attempts it took. "1 Attempt" means they passed on the first try. A high percentage in the "1 Attempt" column indicates strong first-attempt readiness. Broken down by cohort so you can see if newer cohorts are passing more efficiently.
      </p>`;
    html += renderDistTable("End of Course", overall, sg);
    html += `</div>`;

    container.innerHTML = html;
  }

  async function renderTestingLoops() {
    if (testingLoopsRendered) return;
    testingLoopsRendered = true;

    const container = document.getElementById("testing-loops-container");
    const loopData = await loadLoopData();

    if (!loopData || !loopData.students || loopData.students.length === 0) {
      container.innerHTML = '<div class="loading">No testing loop data available. Run collect_loop_data.py to generate loop_data.json.</div>';
      return;
    }

    const students = loopData.students;
    const trends = loopData.trends || {};

    // Summary stats
    const totalStudents = students.length;
    const totalRushing = students.filter(s => s.flags && s.flags.rushing).length;
    const totalWithMasteredGaps = students.filter(s => s.flags && s.flags.mastered_in_alphawrite_not_tests && s.flags.mastered_in_alphawrite_not_tests.length > 0).length;
    const totalDepreciating = students.filter(s => s.flags && s.flags.depreciating_skills && s.flags.depreciating_skills.length > 0).length;

    // Grade distribution
    const gradeCount = {};
    students.forEach(s => {
      (s.loop_details || []).forEach(d => {
        const g = d.grade;
        gradeCount[g] = (gradeCount[g] || 0) + 1;
      });
    });

    let html = `
      <h2 style="margin-bottom:8px">Testing Loops Analysis</h2>
      <div class="tr-summary" style="margin-bottom:16px">
        <span class="tr-stat"><strong>${totalStudents}</strong> students in loops</span>
        <span class="tr-stat red"><strong>${totalRushing}</strong> with rushing</span>
        <span class="tr-stat" style="color:var(--orange)"><strong>${totalDepreciating}</strong> with depreciating skills</span>
        <span class="tr-stat" style="color:var(--purple,#9b59b6)"><strong>${totalWithMasteredGaps}</strong> with AlphaWrite/test gaps</span>
      </div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px">
        ${Object.entries(gradeCount).sort(([a],[b]) => a-b).map(([g, c]) =>
          `<div class="metric-card" style="min-width:80px;text-align:center;padding:8px 12px">
            <div style="font-size:1.3rem;font-weight:700">G${g}</div>
            <div style="font-size:0.8rem;color:var(--text-muted)">${c} student${c>1?'s':''}</div>
          </div>`
        ).join("")}
      </div>`;

    // General trends section (if Claude analysis available)
    if (trends.common_skill_gaps) {
      html += `<div class="loop-trends" style="background:var(--card-bg);border:1px solid var(--border);border-radius:8px;padding:16px;margin-bottom:20px">
        <h3 style="margin-bottom:12px">General Trends</h3>`;
      if (trends.common_skill_gaps) {
        html += `<div style="margin-bottom:8px"><strong>Common Skill Gaps:</strong><br>${esc(trends.common_skill_gaps)}</div>`;
      }
      if (trends.curriculum_gaps) {
        html += `<div style="margin-bottom:8px"><strong>Curriculum Gaps:</strong><br>${esc(trends.curriculum_gaps)}</div>`;
      }
      if (trends.rushing_trends) {
        html += `<div style="margin-bottom:8px"><strong>Rushing Trends:</strong><br>${esc(trends.rushing_trends)}</div>`;
      }
      if (trends.grade_level_patterns) {
        html += `<div style="margin-bottom:8px"><strong>Grade Level Patterns:</strong><br>${esc(trends.grade_level_patterns)}</div>`;
      }
      if (trends.top_recommendations) {
        html += `<div style="margin-bottom:8px"><strong>Recommendations:</strong><br>${esc(trends.top_recommendations)}</div>`;
      }
      html += `</div>`;
    }

    // Filters
    html += `
      <div class="tr-filters" style="margin-bottom:16px">
        <input type="text" id="loop-search" class="search-input" placeholder="Search by student name..." autocomplete="off" style="max-width:280px">
        <select id="loop-grade-filter" class="dropdown">
          <option value="all">All Grades</option>
          ${Object.keys(gradeCount).sort().map(g => `<option value="${g}">G${g}</option>`).join("")}
        </select>
        <select id="loop-flag-filter" class="dropdown">
          <option value="all">All Flags</option>
          <option value="rushing">Rushing</option>
          <option value="depreciating">Depreciating Skills</option>
          <option value="aw-gap">AlphaWrite/Test Gap</option>
        </select>
        <span class="tr-count" id="loop-count">${totalStudents} students</span>
      </div>`;

    // Student cards
    html += `<div id="loop-students">`;
    const sorted = [...students].sort((a, b) => a.name.localeCompare(b.name));
    for (const s of sorted) {
      const loopGrades = (s.loop_details || []).map(d => `G${d.grade}`).join(", ");
      const flagBadges = [];
      if (s.flags?.rushing) flagBadges.push('<span class="loop-badge rush">Rushing</span>');
      if (s.flags?.depreciating_skills?.length) flagBadges.push('<span class="loop-badge deprec">Depreciating</span>');
      if (s.flags?.mastered_in_alphawrite_not_tests?.length) flagBadges.push('<span class="loop-badge aw-gap">AW/Test Gap</span>');

      const priority = s.analysis?.priority || "";
      const priorityCls = priority === "high" ? "priority-high" : priority === "medium" ? "priority-med" : "";

      html += `
        <div class="loop-card" data-name="${esc(s.name.toLowerCase())}" data-grades="${(s.loop_details||[]).map(d=>d.grade).join(",")}" data-flags="${s.flags?.rushing?'rushing ':'' }${s.flags?.depreciating_skills?.length?'depreciating ':'' }${s.flags?.mastered_in_alphawrite_not_tests?.length?'aw-gap':''}">
          <div class="loop-card-header" onclick="this.parentElement.classList.toggle('expanded')">
            <div class="loop-card-summary">
              <strong>${esc(s.name)}</strong>
              <span class="loop-meta">HMG G${s.hmg} ${s.effective_grade ? `| EG G${s.effective_grade}` : ""} | Loop at ${loopGrades} | ${s.total_failed_tests} failed tests</span>
              ${flagBadges.join(" ")}
              ${priorityCls ? `<span class="loop-badge ${priorityCls}">${esc(priority)}</span>` : ""}
            </div>
            <span class="loop-expand-icon">&#9660;</span>
          </div>
          <div class="loop-card-detail">
            ${buildLoopStudentDetail(s)}
          </div>
        </div>`;
    }
    html += `</div>`;

    container.innerHTML = html;

    // Wire filters
    const loopFilters = { search: "", grade: "all", flag: "all" };
    function applyLoopFilters() {
      const cards = container.querySelectorAll(".loop-card");
      let visible = 0;
      cards.forEach(card => {
        const nameMatch = !loopFilters.search || card.dataset.name.includes(loopFilters.search);
        const gradeMatch = loopFilters.grade === "all" || card.dataset.grades.split(",").includes(loopFilters.grade);
        const flagMatch = loopFilters.flag === "all" || card.dataset.flags.includes(loopFilters.flag);
        const show = nameMatch && gradeMatch && flagMatch;
        card.classList.toggle("hidden", !show);
        if (show) visible++;
      });
      document.getElementById("loop-count").textContent = `${visible} of ${totalStudents} students`;
    }

    document.getElementById("loop-grade-filter").addEventListener("change", e => {
      loopFilters.grade = e.target.value;
      applyLoopFilters();
    });
    document.getElementById("loop-flag-filter").addEventListener("change", e => {
      loopFilters.flag = e.target.value;
      applyLoopFilters();
    });
    let loopTimer;
    document.getElementById("loop-search").addEventListener("input", e => {
      clearTimeout(loopTimer);
      loopTimer = setTimeout(() => {
        loopFilters.search = e.target.value.toLowerCase().trim();
        applyLoopFilters();
      }, 200);
    });
  }

  function buildLoopStudentDetail(s) {
    let html = "";

    // Claude analysis summary
    const a = s.analysis || {};
    if (a.pattern_summary) {
      html += `<div class="loop-section">
        <h4>Analysis</h4>
        <div class="loop-analysis-field"><strong>Pattern:</strong> ${esc(a.pattern_summary)}</div>`;
      if (a.skill_gaps) html += `<div class="loop-analysis-field"><strong>Skill Gaps:</strong> ${esc(a.skill_gaps)}</div>`;
      if (a.alphawrite_vs_test) html += `<div class="loop-analysis-field"><strong>AlphaWrite vs Test:</strong> ${esc(a.alphawrite_vs_test)}</div>`;
      if (a.rushing_impact) html += `<div class="loop-analysis-field"><strong>Rushing Impact:</strong> ${esc(a.rushing_impact)}</div>`;
      if (a.recommended_activities) html += `<div class="loop-analysis-field"><strong>Recommended Activities:</strong><br>${esc(a.recommended_activities).replace(/\n/g, '<br>')}</div>`;
      html += `</div>`;
    }

    // Flags detail
    const flags = s.flags || {};
    if (flags.rushing || flags.depreciating_skills?.length || flags.mastered_in_alphawrite_not_tests?.length) {
      html += `<div class="loop-section"><h4>Flags</h4>`;
      if (flags.rushing) {
        html += `<div class="loop-flag rush-flag">Rushed ${flags.rushed_count} test(s)</div>`;
      }
      if (flags.depreciating_skills?.length) {
        html += `<div class="loop-flag deprec-flag">Depreciating skills:</div><ul>`;
        for (const sk of flags.depreciating_skills) {
          html += `<li>${esc(sk.course ? sk.course + " > " : "")}${esc(sk.skill)}: ${sk.best_accuracy}% &rarr; ${sk.latest_accuracy}%</li>`;
        }
        html += `</ul>`;
      }
      if (flags.mastered_in_alphawrite_not_tests?.length) {
        html += `<div class="loop-flag aw-flag">Mastered in AlphaWrite but failing tests (${flags.mastered_in_alphawrite_not_tests.length} skills)</div>`;
      }
      html += `</div>`;
    }

    // Test results with dropdown per test
    if (s.tests && s.tests.length > 0) {
      html += `<div class="loop-section"><h4>Test Results (${s.tests.length})</h4>`;
      for (const t of s.tests) {
        const wrongCount = t.incorrect_questions ? t.incorrect_questions.length : 0;
        const rushed = t.rushed ? ' <span class="loop-badge rush">RUSHED</span>' : "";
        html += `
          <div class="loop-test">
            <div class="loop-test-header" onclick="this.parentElement.classList.toggle('test-expanded')">
              <span class="loop-test-name">${esc(t.test_name)}</span>
              <span class="loop-test-meta">${t.score}% | ${t.date} | ${wrongCount} wrong${rushed}</span>
              <span class="loop-expand-icon">&#9660;</span>
            </div>
            <div class="loop-test-detail">`;

        // Show questions
        if (t.questions && t.questions.length > 0) {
          html += `<table class="metrics-table loop-q-table">
            <thead><tr><th>Q#</th><th>Type</th><th>Result</th><th>Prompt</th><th>Student Answer</th></tr></thead>
            <tbody>`;
          for (const q of t.questions) {
            const frac = q.correct_fraction;
            const resultCls = frac === null ? "" : frac >= 1.0 ? "score-pass" : frac > 0 ? "score-partial" : "score-fail";
            const resultLabel = frac === null ? "N/A" : frac >= 1.0 ? "Correct" : frac > 0 ? `Partial (${Math.round(frac*100)}%)` : "Incorrect";
            const prompt = (q.prompt || "").slice(0, 200);
            const answer = q.student_answer || "";
            html += `<tr class="${resultCls}">
              <td>${q.number || "?"}</td>
              <td>${esc(q.title || q.type || "")}</td>
              <td><span class="${resultCls}">${resultLabel}</span></td>
              <td class="loop-q-text">${esc(prompt)}${prompt.length >= 200 ? "..." : ""}</td>
              <td class="loop-q-text" style="${answer.length > 300 ? "white-space:pre-wrap" : ""}">${esc(answer)}</td>
            </tr>`;
          }
          html += `</tbody></table>`;
        }

        html += `</div></div>`;
      }
      html += `</div>`;
    }

    // AlphaWrite skill performance
    if (s.skills && s.skills.length > 0) {
      // Group by course
      const byCourse = {};
      for (const sk of s.skills) {
        const course = sk.course || "Other";
        if (!byCourse[course]) byCourse[course] = [];
        byCourse[course].push(sk);
      }

      html += `<div class="loop-section"><h4>AlphaWrite Skills (${s.skills.length})</h4>`;
      for (const [course, skills] of Object.entries(byCourse).sort()) {
        html += `<div class="loop-skill-course">
          <div class="loop-skill-course-header" onclick="this.parentElement.classList.toggle('course-expanded')">
            <strong>${esc(course)}</strong> <span style="color:var(--text-muted)">(${skills.length} skills)</span>
            <span class="loop-expand-icon">&#9660;</span>
          </div>
          <div class="loop-skill-course-detail">
            <table class="metrics-table loop-skill-table">
              <thead><tr><th>Skill</th><th>Attempts</th><th>Best</th><th>Latest</th><th>Mastered</th><th>Flags</th></tr></thead>
              <tbody>`;
        for (const sk of skills) {
          const flags = [];
          if (sk.mastered) flags.push('<span class="loop-badge mastered">Mastered</span>');
          if (sk.depreciating) flags.push('<span class="loop-badge deprec">Depreciating</span>');
          const bestCls = sk.best_accuracy !== null && sk.best_accuracy >= 80 ? "score-pass" : "score-fail";
          const latestCls = sk.latest_accuracy !== null && sk.latest_accuracy >= 80 ? "score-pass" : "score-fail";
          html += `<tr>
            <td>${esc(sk.skill)}</td>
            <td>${sk.attempts}</td>
            <td class="${bestCls}">${sk.best_accuracy !== null ? sk.best_accuracy + "%" : "-"}</td>
            <td class="${latestCls}">${sk.latest_accuracy !== null ? Math.round(sk.latest_accuracy) + "%" : "-"}</td>
            <td>${sk.mastered ? "Yes" : "No"}</td>
            <td>${flags.join(" ")}</td>
          </tr>`;
        }
        html += `</tbody></table></div></div>`;
      }
      html += `</div>`;
    }

    return html;
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  /**
   * Compute week boundaries for a session.
   * Returns array of {key, start, end, label} objects.
   * S4 includes a Break week before school starts.
   */
  function computeSessionWeeks(sessionName, sessionData) {
    const weeks = [];
    const schoolStart = sessionData.school_start || sessionData.start;

    // S4 has a break week before school starts
    if (sessionData.school_start && sessionData.start < sessionData.school_start) {
      const breakEnd = new Date(new Date(schoolStart + "T00:00:00").getTime() - 86400000);
      weeks.push({
        key: "Break",
        start: sessionData.start,
        end: breakEnd.toISOString().slice(0, 10),
        label: `Break`,
        isBreak: true,
      });
    }

    const start = new Date(schoolStart + "T00:00:00");
    const end = new Date(sessionData.end + "T00:00:00");
    // Find the Saturday of the start week (Mon-Sat school week)
    let wkStart = new Date(start);
    let wkNum = 1;
    while (wkStart <= end) {
      // Week ends on Saturday, or on session end
      const sat = new Date(wkStart);
      sat.setDate(sat.getDate() + (6 - sat.getDay()) % 7 || 7); // next Saturday
      // Actually compute Sun end-of-week
      const sun = new Date(wkStart);
      const daysToSun = (7 - sun.getDay()) % 7;
      sun.setDate(sun.getDate() + daysToSun);
      const wkEnd = sun > end ? end : sun;

      weeks.push({
        key: `Wk${wkNum}`,
        start: wkStart.toISOString().slice(0, 10),
        end: wkEnd.toISOString().slice(0, 10),
        label: `Wk${wkNum}`,
        isBreak: false,
      });

      // Next Monday
      const nextMon = new Date(wkEnd);
      nextMon.setDate(nextMon.getDate() + 1);
      // If wkEnd is already Sunday, nextMon is Monday
      // If wkEnd is end-of-session mid-week, we're done
      if (nextMon > end) break;
      wkStart = nextMon;
      wkNum++;
    }
    return weeks;
  }

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

  function formatDateFull(dateStr) {
    if (!dateStr) return "-";
    try {
      const d = new Date(dateStr + "T00:00:00");
      const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      return `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
    } catch { return dateStr; }
  }

  // ── Start ───────────────────────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", init);
})();
