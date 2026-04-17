/**
 * Round 1 Applications — Read-Only View
 * Accessible to both R1 and R2 judges.
 * R2 judges can browse and search all R1 applications for their county and view scores,
 * but cannot submit evaluations.
 * Route: /app/round-1-view        → list
 *        /app/round-1-view/{name} → detail
 */

frappe.pages['round-1-view'].on_page_load = function (wrapper) {
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: 'Round 1 Applications',
        single_column: true,
    });
    page.set_secondary_action('← Back to Dashboard', () => frappe.set_route('judge-dashboard'));
    wrapper._r1view = new R1ViewPage(page);
};

frappe.pages['round-1-view'].on_page_show = function (wrapper) {
    if (!wrapper._r1view) return;
    const appId = frappe.get_route()[1];
    if (appId) wrapper._r1view.showDetail(appId);
    else       wrapper._r1view.showList();
};

class R1ViewPage {
    constructor(page) {
        this.page         = page;
        this.wrapper      = $(this.page.body);
        this.applications = [];
        this.county       = '';
        this.searchQuery  = '';
    }

    // ── List view ────────────────────────────────────────────────────────────

    showList() {
        this.page.set_title('Round 1 Applications');
        this.wrapper.html(this.loadingHtml());

        frappe.call({
            method: 'agri_judge.agri_judge.api.judging.get_r1_applications_view',
            callback: r => {
                if (r.message && r.message.success) {
                    this.applications = r.message.applications || [];
                    this.county       = r.message.county || '';
                    this.renderList();
                } else {
                    this.renderError(r.message?.error || 'Failed to load applications.');
                }
            },
        });
    }

    renderList() {
        const apps = this.filteredApps();
        this.wrapper.html(`
            ${this.getStyles()}
            <div class="r1v-page">
                <div class="r1v-list-header">
                    <div>
                        <h1>Round 1 Applications</h1>
                        <div class="r1v-county-badge">📍 ${frappe.utils.escape_html(this.county)}</div>
                        <p class="r1v-subtitle">Read-only · ${this.applications.length} applications in your county</p>
                    </div>
                    <div class="r1v-header-note">
                        👁 You are viewing Round 1 scores — evaluations cannot be submitted here.
                    </div>
                </div>

                <div class="r1v-search-bar">
                    <input type="text" class="r1v-search-input" id="r1v-search"
                        placeholder="🔍 Search by applicant name…"
                        value="${frappe.utils.escape_html(this.searchQuery)}"
                        oninput="window.R1V.onSearch(this.value)" />
                    <span class="r1v-search-count" id="r1v-count">${apps.length} shown</span>
                </div>

                <div class="r1v-list" id="r1v-list">
                    ${this.renderCards(apps)}
                </div>
            </div>
        `);
        window.R1V = this;
    }

    filteredApps() {
        if (!this.searchQuery) return this.applications;
        const q = this.searchQuery.toLowerCase();
        return this.applications.filter(a =>
            (a.applicant_name || '').toLowerCase().includes(q) ||
            (a.county || '').toLowerCase().includes(q)
        );
    }

    onSearch(value) {
        this.searchQuery = value;
        const apps     = this.filteredApps();
        const listEl   = document.getElementById('r1v-list');
        const countEl  = document.getElementById('r1v-count');
        if (countEl) countEl.textContent = apps.length + ' shown';
        if (listEl)  listEl.innerHTML = this.renderCards(apps);
    }

    renderCards(apps) {
        if (apps.length === 0) {
            return `<div class="r1v-empty">
                <div style="font-size:40px;margin-bottom:12px;">🔍</div>
                <p>${this.searchQuery ? 'No applications match your search.' : 'No applications found for your county.'}</p>
            </div>`;
        }
        return apps.map(a => this.renderCard(a)).join('');
    }

    renderCard(app) {
        const hasScore   = app.eval_count > 0;
        const scoreClass = this.scoreClass(app.avg_score, hasScore);
        return `
        <div class="r1v-card" onclick="window.R1V.openDetail('${frappe.utils.escape_html(app.name)}')">
            <div class="r1v-card-left">
                <div class="r1v-card-name">${frappe.utils.escape_html(app.applicant_name)}</div>
                <div class="r1v-card-meta">
                    <span>📍 ${frappe.utils.escape_html(app.county || '—')}</span>
                    <span>⚥ ${frappe.utils.escape_html(app.gender || '—')}</span>
                    <span>🏷 ${frappe.utils.escape_html(app.category || '—')}</span>
                    <span>👥 ${app.eval_count} judge${app.eval_count !== 1 ? 's' : ''}</span>
                </div>
            </div>
            <div class="r1v-card-right">
                <div class="r1v-score ${scoreClass}">
                    ${hasScore ? app.avg_score.toFixed(2) + '<span>/10</span>' : '<span>Not scored</span>'}
                </div>
                <span class="r1v-view-link">View →</span>
            </div>
        </div>`;
    }

    openDetail(appName) {
        frappe.set_route('round-1-view', appName);
    }

    // ── Detail view ──────────────────────────────────────────────────────────

    showDetail(appName) {
        this.page.set_title('Application — Read Only');
        this.wrapper.html(this.loadingHtml());

        frappe.call({
            method: 'agri_judge.agri_judge.api.judging.get_r1_application_read_only',
            args: { application_name: appName },
            callback: r => {
                if (r.message && r.message.success) {
                    this.renderDetail(r.message);
                } else {
                    this.renderError(r.message?.error || 'Failed to load application.');
                }
            },
        });
    }

    renderDetail(data) {
        const app      = data.application;
        const evals    = data.evaluations || [];
        const avgScore = data.avg_score;
        const hasScore = evals.length > 0;
        const orbClass = this.scoreClass(avgScore, hasScore);

        const criteriaLabels = {
            technical:       'Technical Capabilities',
            innovativeness:  'Innovativeness',
            scalability:     'Scalability & Viability',
            market:          'Market & Environmental Impact',
            founder:         'Founder Background',
        };

        const evalsHtml = evals.length === 0
            ? `<p class="r1v-no-evals">No evaluations submitted yet.</p>`
            : evals.map((ev, i) => `
              <div class="r1v-eval-card">
                  <div class="r1v-eval-header">
                      <span class="r1v-eval-label">Judge ${i + 1}</span>
                      <span class="r1v-eval-score ${this.scoreClass(ev.final_score, true)}">${ev.final_score.toFixed(2)} / 10</span>
                      ${ev.female_led_bonus ? '<span class="r1v-female-badge">👑 Female-led bonus</span>' : ''}
                  </div>
                  <div class="r1v-criteria-grid">
                      ${(ev.criteria || []).map(c => `
                      <div class="r1v-crit-name">${frappe.utils.escape_html(criteriaLabels[c.criterion_id] || c.criterion_id)}</div>
                      <div class="r1v-crit-score">${c.score} / 10</div>`).join('')}
                  </div>
              </div>`).join('');

        const field = (label, value) => value
            ? `<div class="r1v-field">
                   <span class="r1v-field-label">${label}</span>
                   <div class="r1v-field-value">${frappe.utils.escape_html(value)}</div>
               </div>`
            : '';

        this.wrapper.html(`
            ${this.getStyles()}
            <div class="r1v-page">

                <button class="r1v-back-btn" onclick="frappe.set_route('round-1-view')">← Back to List</button>

                <div class="r1v-detail-header">
                    <div>
                        <h1>${frappe.utils.escape_html(app.full_name)}</h1>
                        <div class="r1v-header-meta">
                            📍 ${frappe.utils.escape_html(app.county_of_residence || '—')}
                            ${app.gender   ? ' · ' + frappe.utils.escape_html(app.gender)   : ''}
                            ${app.age_group ? ' · Age: ' + frappe.utils.escape_html(app.age_group) : ''}
                        </div>
                        <div class="r1v-readonly-banner">👁 Read-only — Round 2 judges may view scores but cannot score here.</div>
                    </div>
                    <div class="r1v-avg-orb ${orbClass}">
                        <div class="r1v-orb-lbl">Avg Score</div>
                        <div class="r1v-orb-val">${hasScore ? avgScore.toFixed(2) : '—'}</div>
                        <div class="r1v-orb-max">${hasScore ? '/ 10' : 'Not scored'}</div>
                        <div class="r1v-orb-count">${evals.length} judge${evals.length !== 1 ? 's' : ''}</div>
                    </div>
                </div>

                <div class="r1v-detail-body">

                    <div class="r1v-detail-left">
                        <div class="r1v-section">
                            <h3 class="r1v-section-title">📋 Application Details</h3>
                            ${field('Level of Project',             app.level_of_project)}
                            ${field('Prior Experience',             app.prior_experience)}
                            ${field('Proposed Product',             app.proposed_product)}
                            ${field('Describe Your Idea',           app.describe_your_idea)}
                            ${field('Production Process',           app.production_process)}
                            ${field('Environmental Contributions',  app.enviromental_contributions)}
                            ${field('Demonstrate Innovativeness',   app.demonstrate_innovativeness)}
                            ${field('Enterprise Benefits',          app.enterprise_benefits)}
                            ${field('Use of Micro Grant',           app.use_of_micro_grant)}
                            ${field('Next Step Skills',             app.next_step_skills)}
                            ${app.youtube_link
                                ? `<div class="r1v-field">
                                       <span class="r1v-field-label">Video</span>
                                       <a href="${frappe.utils.escape_html(app.youtube_link)}" target="_blank" class="r1v-link">▶ Watch Video</a>
                                   </div>`
                                : ''}
                        </div>
                    </div>

                    <div class="r1v-detail-right">
                        <div class="r1v-section">
                            <h3 class="r1v-section-title">📊 Judge Scores</h3>
                            ${evalsHtml}
                        </div>
                    </div>

                </div>
            </div>
        `);

        window.R1V = this;
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    scoreClass(score, hasScore) {
        if (!hasScore) return 'score-none';
        if (score >= 7)  return 'score-high';
        if (score >= 5)  return 'score-mid';
        return 'score-low';
    }

    loadingHtml() {
        return `<div style="padding:60px;text-align:center;color:#888;">
            <div style="font-size:40px;margin-bottom:12px;">⏳</div><p>Loading…</p>
        </div>`;
    }

    renderError(msg) {
        this.wrapper.html(`
            ${this.getStyles()}
            <div style="padding:60px;text-align:center;color:#C62828;">
                <div style="font-size:40px;margin-bottom:12px;">⚠️</div>
                <p>${frappe.utils.escape_html(msg)}</p>
                <button class="r1v-back-btn" style="margin-top:16px;" onclick="frappe.set_route('judge-dashboard')">← Back to Dashboard</button>
            </div>
        `);
    }

    getStyles() {
        return `<style>
        .r1v-page { font-family:var(--font-stack); max-width:1240px; margin:0 auto; padding:16px; }

        /* List header */
        .r1v-list-header { background:#fff; border:1px solid #e0e0e0; border-radius:10px; padding:20px 24px; margin-bottom:14px; display:flex; justify-content:space-between; align-items:flex-start; gap:16px; flex-wrap:wrap; }
        .r1v-list-header h1 { margin:0 0 6px; font-size:22px; font-weight:700; }
        .r1v-county-badge { display:inline-block; background:#E3F2FD; color:#1565C0; padding:3px 12px; border-radius:12px; font-size:12px; font-weight:600; margin-bottom:6px; }
        .r1v-subtitle { margin:0; font-size:12px; color:#777; }
        .r1v-header-note { background:#FFF3E0; color:#E65100; border-radius:8px; padding:10px 14px; font-size:12px; font-weight:500; max-width:340px; text-align:center; align-self:center; }

        /* Search */
        .r1v-search-bar { display:flex; align-items:center; gap:12px; margin-bottom:12px; }
        .r1v-search-input { flex:1; border:1px solid #ddd; border-radius:8px; padding:9px 14px; font-size:14px; font-family:var(--font-stack); outline:none; transition:border-color .15s; }
        .r1v-search-input:focus { border-color:#1565C0; }
        .r1v-search-count { font-size:12px; color:#aaa; white-space:nowrap; }

        /* Cards */
        .r1v-card { background:#fff; border:1px solid #e0e0e0; border-left:4px solid #ED1B2E; border-radius:10px; padding:16px 20px; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center; cursor:pointer; transition:transform .15s,box-shadow .15s; }
        .r1v-card:hover { transform:translateY(-2px); box-shadow:0 4px 14px rgba(0,0,0,.1); }
        .r1v-card-name { font-size:16px; font-weight:700; margin-bottom:6px; }
        .r1v-card-meta { display:flex; gap:14px; font-size:12px; color:#777; flex-wrap:wrap; }
        .r1v-card-right { display:flex; flex-direction:column; align-items:flex-end; gap:6px; flex-shrink:0; }
        .r1v-view-link { font-size:12px; color:#1565C0; font-weight:600; }
        .r1v-empty { background:#fff; border-radius:10px; padding:50px; text-align:center; color:#aaa; font-size:14px; }

        /* Score colours */
        .r1v-score { font-size:22px; font-weight:800; }
        .r1v-score span { font-size:12px; opacity:.6; }
        .score-high { color:#2E7D32; }
        .score-mid  { color:#E65100; }
        .score-low  { color:#C62828; }
        .score-none { color:#aaa; font-size:14px; font-weight:600; }

        /* Back button */
        .r1v-back-btn { background:#546E7A; color:#fff; border:none; padding:8px 16px; border-radius:7px; font-size:13px; font-weight:600; cursor:pointer; margin-bottom:14px; transition:background .15s; }
        .r1v-back-btn:hover { background:#37474F; }

        /* Detail header */
        .r1v-detail-header { background:#fff; border:1px solid #e0e0e0; border-radius:10px; padding:20px 24px; margin-bottom:14px; display:flex; justify-content:space-between; align-items:flex-start; gap:16px; flex-wrap:wrap; }
        .r1v-detail-header h1 { margin:0 0 6px; font-size:20px; font-weight:700; }
        .r1v-header-meta { font-size:13px; color:#666; margin-bottom:6px; }
        .r1v-readonly-banner { background:#E3F2FD; color:#1565C0; border-radius:6px; padding:7px 12px; font-size:12px; font-weight:500; margin-top:8px; display:inline-block; }

        /* Avg orb */
        .r1v-avg-orb { text-align:center; background:#f8f9fa; border:2px solid #e0e0e0; border-radius:10px; padding:14px 22px; min-width:120px; flex-shrink:0; }
        .r1v-orb-lbl { font-size:10px; color:#888; text-transform:uppercase; letter-spacing:.5px; margin-bottom:2px; }
        .r1v-orb-val { font-size:34px; font-weight:800; line-height:1.1; }
        .r1v-orb-max { font-size:12px; color:#888; }
        .r1v-orb-count { font-size:11px; color:#aaa; margin-top:2px; }
        .r1v-avg-orb.score-high { border-color:#4CAF50; }
        .r1v-avg-orb.score-high .r1v-orb-val { color:#2E7D32; }
        .r1v-avg-orb.score-mid  { border-color:#FF9800; }
        .r1v-avg-orb.score-mid  .r1v-orb-val { color:#E65100; }
        .r1v-avg-orb.score-low  { border-color:#ef5350; }
        .r1v-avg-orb.score-low  .r1v-orb-val { color:#C62828; }
        .r1v-avg-orb.score-none .r1v-orb-val { color:#aaa; }

        /* Detail two-column body */
        .r1v-detail-body { display:flex; gap:16px; align-items:flex-start; padding-bottom:24px; }
        .r1v-detail-left { flex:1; min-width:0; }
        .r1v-detail-right { width:340px; flex-shrink:0; position:sticky; top:70px; max-height:calc(100vh - 90px); overflow-y:auto; }

        /* Sections */
        .r1v-section { background:#fff; border:1px solid #e0e0e0; border-radius:10px; padding:20px 22px; margin-bottom:14px; }
        .r1v-section-title { margin:0 0 14px; font-size:14px; font-weight:700; color:#333; }
        .r1v-field { margin-bottom:12px; }
        .r1v-field-label { display:block; font-size:10px; font-weight:600; color:#888; text-transform:uppercase; letter-spacing:.5px; margin-bottom:3px; }
        .r1v-field-value { font-size:13px; color:#333; line-height:1.6; }
        .r1v-link { color:#1565C0; font-size:13px; }

        /* Eval cards */
        .r1v-eval-card { border:1px solid #e8e8e8; border-radius:8px; padding:12px 14px; margin-bottom:8px; }
        .r1v-eval-header { display:flex; align-items:center; gap:10px; margin-bottom:8px; flex-wrap:wrap; }
        .r1v-eval-label { font-size:12px; font-weight:600; color:#666; background:#f5f5f5; padding:2px 8px; border-radius:6px; }
        .r1v-eval-score { font-size:16px; font-weight:800; }
        .r1v-female-badge { background:#FFF8E1; color:#E65100; font-size:11px; padding:2px 7px; border-radius:10px; }
        .r1v-criteria-grid { display:grid; grid-template-columns:1fr auto; gap:3px 12px; font-size:12px; }
        .r1v-crit-name { color:#555; padding:2px 0; }
        .r1v-crit-score { font-weight:700; color:#333; text-align:right; padding:2px 0; }
        .r1v-no-evals { color:#aaa; font-size:13px; font-style:italic; margin:0; }

        @media (max-width: 900px) {
            .r1v-detail-body { flex-direction:column; }
            .r1v-detail-right { width:100%; position:static; max-height:none; }
            .r1v-list-header { flex-direction:column; }
        }
        </style>`;
    }
}
