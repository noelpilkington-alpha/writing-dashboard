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
            XP: ${Math.round(s.xp.total)}/${Math.round(s.xp.goal_to_date)} (${xpPct}%)
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
          <th>HMG</th><th>XP</th><th>Last Test</th><th>Insights</th>
        </tr>
    `;

    const sorted = [...students].sort((a, b) => a.name.localeCompare(b.name));
    for (const s of sorted) {
      const xpPct = s.xp.goal_to_date > 0 ? Math.round((s.xp.total / s.xp.goal_to_date) * 100) : 0;
      const xpCls = s.xp.meets_goal ? "score-pass" : "score-fail";
      const lastTest = s.last_test
        ? `${s.last_test.name} (${s.last_test.score}%) ${s.last_test.passed ? "✓" : "✗"}`
        : "-";
      const insightCount = s.insights.length;

      html += `<tr>
        <td><strong>${esc(s.name)}</strong></td>
        <td>${esc(s.email)}</td>
        <td>${esc(s.campus)}</td>
        <td>${esc(s.level)}</td>
        <td>G${s.hmg}</td>
        <td class="${xpCls}">${Math.round(s.xp.total)}/${Math.round(s.xp.goal_to_date)} (${xpPct}%)</td>
        <td>${lastTest}</td>
        <td>${insightCount > 0 ? `<span class="score-fail">${insightCount}</span>` : '<span class="score-pass">0</span>'}</td>
      </tr>`;
    }
    html += `</table>`;

    el.innerHTML = html;
    el.classList.remove("hidden");

    el.querySelector(".drilldown-close").addEventListener("click", () => {
      el.classList.add("hidden");
    });

    // Scroll to drilldown
    el.scrollIntoView({ behavior: "smooth", block: "start" });
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
