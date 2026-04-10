/**
 * Round 2 Scoring Dashboard
 * Coordinator-only view of all R2 applicant scoring status.
 * Shows per-applicant: judges completed, avg score, passes cut-off, leverage.
 * Click any applicant to open their judge review page.
 */

frappe.pages['round-2-scoring-dashboard'].on_page_load = function(wrapper) {
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: 'Round 2 — Scoring Dashboard',
        single_column: true
    });
    page.add_button('Home', () => frappe.set_route('/app'), 'octicon octicon-home');
    page.add_button('Round 2 Applicants', () => frappe.set_route('round-2-applicants'), 'octicon octicon-checklist');
    page.add_button('Leaderboard', () => frappe.set_route('judging-leaderboard'), 'octicon octicon-list-ordered');
    page.set_primary_action('Refresh', () => wrapper._r2sd && wrapper._r2sd.load(), 'octicon octicon-sync');
    wrapper._r2sd = new R2ScoringDashboard(page, wrapper);
};

frappe.pages['round-2-scoring-dashboard'].on_page_show = function(wrapper) {
    if (wrapper._r2sd) wrapper._r2sd.load();
};

const CUTOFF = 60;

class R2ScoringDashboard {
    constructor(page, wrapper) {
        this.page    = page;
        this.wrapper = $(wrapper).find('.page-content');
        this.data    = null;
    }

    load() {
        this.wrapper.html(this.loadingHtml());
        frappe.call({
            method: 'agri_judge.agri_judge.api.judging.get_r2_scoring_progress',
            callback: (r) => {
                if (r.message && r.message.success) {
                    this.data = r.message;
                    this.render();
                } else {
                    this.renderError(r.message?.error || 'Failed to load scoring progress.');
                }
            }
        });
    }

    render() {
        const d = this.data;
        const applicants = d.applicants || [];

        // Group by county
        const byCounty = {};
        applicants.forEach(a => {
            const c = a.county || 'Unknown';
            if (!byCounty[c]) byCounty[c] = [];
            byCounty[c].push(a);
        });

        const countyColors = {
            'Kakamega': '#1565C0', 'Homabay': '#2E7D32',
            'Kericho': '#E65100',  'Meru': '#6A1B9A', 'Other': '#37474F'
        };

        const passing = applicants.filter(a => a.passes_cutoff && a.avg_total_score !== null).length;
        const failing = applicants.filter(a => !a.passes_cutoff && a.avg_total_score !== null).length;
        const unscored = applicants.filter(a => a.avg_total_score === null).length;

        const countySections = Object.keys(byCounty).sort().map(county => {
            const apps  = byCounty[county];
            const color = countyColors[county] || '#37474F';
            const done  = apps.filter(a => a.complete).length;
            return `
            <div class="sd-county-card">
                <div class="sd-county-header" style="border-left-color:${color};">
                    <div class="sd-county-title" style="color:${color};">
                        <span class="sd-dot" style="background:${color};"></span>
                        ${frappe.utils.escape_html(county)} County
                    </div>
                    <div class="sd-county-meta">${done}/${apps.length} fully scored</div>
                </div>
                <div class="sd-table-wrap">
                    <table class="sd-table">
                        <thead>
                            <tr>
                                <th>Applicant</th>
                                <th>Leverage</th>
                                <th>Judges</th>
                                <th>Avg Score</th>
                                <th>Status</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            ${apps.map(a => this.renderRow(a)).join('')}
                        </tbody>
                    </table>
                </div>
            </div>`;
        }).join('');

        this.wrapper.html(`
            ${this.getStyles()}
            <div class="sd-wrap">

                <div class="sd-header">
                    <div class="sd-header-inner">
                        <div>
                            <h1>Round 2 — Scoring Dashboard</h1>
                            <p class="sd-subtitle">Cut-off: ${CUTOFF} points · Live progress across all counties</p>
                        </div>
                        <div class="sd-coordinator-badge">Coordinator View</div>
                    </div>
                </div>

                <div class="sd-stats">
                    ${this.statCard(d.total,    'Total R2 Applicants', '#1565C0')}
                    ${this.statCard(d.complete, 'Fully Scored',        '#2E7D32')}
                    ${this.statCard(d.incomplete,'Pending',            '#E65100')}
                    ${this.statCard(passing,    'Above Cut-off',       '#2E7D32')}
                    ${this.statCard(failing,    'Below Cut-off',       '#C62828')}
                    ${this.statCard(unscored,   'Not Yet Scored',      '#78909C')}
                </div>

                ${applicants.length === 0
                    ? `<div class="sd-empty">
                           <div style="font-size:52px;margin-bottom:16px;">📭</div>
                           <strong>No Round 2 applicants found.</strong>
                           <p>Add applicants via the Round 2 Applicants list first.</p>
                       </div>`
                    : countySections
                }

                <div class="sd-footer">
                    Round 2 Scoring Dashboard · Agri Judge · ${new Date().getFullYear()}
                </div>
            </div>
        `);
    }

    renderRow(a) {
        const scored = a.avg_total_score !== null;
        const passes = a.passes_cutoff;
        const scoreDisplay = scored
            ? `<span class="score-num ${passes ? 'pass' : 'fail'}">${a.avg_total_score.toFixed(1)}</span><span class="score-of"> / 110</span>`
            : `<span class="score-dash">—</span>`;

        const statusBadge = !scored
            ? `<span class="badge badge-unscored">Unscored</span>`
            : passes
                ? `<span class="badge badge-pass">✓ Passes</span>`
                : `<span class="badge badge-fail">✗ Below Cutoff</span>`;

        const completeness = a.judges_expected > 0
            ? `${a.judges_completed}/${a.judges_expected}`
            : `${a.judges_completed} judge${a.judges_completed !== 1 ? 's' : ''}`;

        const leverageMap = {
            'Top Shortlisted': { label: 'Top +10', color: '#1565C0' },
            'Above Threshold': { label: 'Above +5', color: '#2E7D32' },
            'At Threshold':    { label: 'At +2',    color: '#E65100' },
            'None':            { label: '—',         color: '#aaa'   },
        };
        const lev = leverageMap[a.leverage_category] || leverageMap['None'];
        const leverageBadge = `<span class="lev-badge" style="color:${lev.color};">${lev.label}</span>`;

        return `
        <tr class="sd-row" onclick="frappe.set_route('round-2-judge-review', '${frappe.utils.escape_html(a.r2_applicant)}')">
            <td class="td-name">${frappe.utils.escape_html(a.applicant_name || a.r2_applicant)}</td>
            <td>${leverageBadge}</td>
            <td class="td-judges">${completeness}</td>
            <td class="td-score">${scoreDisplay}</td>
            <td>${statusBadge}</td>
            <td class="td-arrow">→</td>
        </tr>`;
    }

    statCard(value, label, color) {
        return `
        <div class="sd-stat-card" style="border-top-color:${color};">
            <div class="sd-stat-value" style="color:${color};">${value}</div>
            <div class="sd-stat-label">${label}</div>
        </div>`;
    }

    loadingHtml() {
        return `<div style="padding:80px;text-align:center;color:#888;">
            <div style="font-size:40px;margin-bottom:12px;">⏳</div>
            <p>Loading scoring progress…</p>
        </div>`;
    }

    renderError(msg) {
        this.wrapper.html(`<div style="padding:60px;text-align:center;color:#C62828;">
            <div style="font-size:40px;margin-bottom:12px;">⚠️</div>
            <p>${frappe.utils.escape_html(msg)}</p>
        </div>`);
    }

    getStyles() {
        return `<style>
        .sd-wrap { max-width:1100px; margin:0 auto; padding:20px 16px 60px; font-family:var(--font-stack,Arial,sans-serif); }

        /* Header */
        .sd-header { background:linear-gradient(135deg,#1565C0 0%,#0D47A1 100%); padding:24px 28px; border-radius:10px; margin-bottom:20px; }
        .sd-header-inner { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; }
        .sd-header h1 { margin:0 0 4px; font-size:22px; font-weight:700; color:white; }
        .sd-subtitle { margin:0; color:rgba(255,255,255,.8); font-size:13px; }
        .sd-coordinator-badge { background:rgba(255,255,255,.15); border:1.5px solid rgba(255,255,255,.5); color:white; padding:5px 14px; border-radius:20px; font-size:12px; font-weight:600; }

        /* Stats */
        .sd-stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:12px; margin-bottom:22px; }
        .sd-stat-card { background:#fff; border:1px solid #e0e0e0; border-top:3px solid #ccc; border-radius:8px; padding:14px 16px; text-align:center; }
        .sd-stat-value { font-size:28px; font-weight:800; line-height:1.2; }
        .sd-stat-label { font-size:11px; color:#666; margin-top:4px; text-transform:uppercase; letter-spacing:.5px; }

        /* County card */
        .sd-county-card { background:#fff; border:1px solid #e0e0e0; border-radius:10px; margin-bottom:18px; overflow:hidden; }
        .sd-county-header { display:flex; justify-content:space-between; align-items:center; padding:13px 18px; border-left:4px solid #ccc; background:#fafafa; }
        .sd-county-title { display:flex; align-items:center; gap:8px; font-weight:700; font-size:15px; }
        .sd-dot { width:10px; height:10px; border-radius:50%; display:inline-block; flex-shrink:0; }
        .sd-county-meta { font-size:12px; color:#666; }

        /* Table */
        .sd-table-wrap { overflow-x:auto; }
        .sd-table { width:100%; border-collapse:collapse; }
        .sd-table thead tr { background:#f9f9f9; }
        .sd-table th { padding:9px 14px; font-size:11px; color:#888; text-transform:uppercase; letter-spacing:.4px; font-weight:600; text-align:left; border-bottom:1px solid #eee; white-space:nowrap; }
        .sd-row { cursor:pointer; transition:background .15s; border-top:1px solid #eee; }
        .sd-row:hover { background:#f0f4ff; }
        .sd-table td { padding:11px 14px; font-size:13px; vertical-align:middle; }
        .td-name { font-weight:600; color:#1a1a1a; }
        .td-judges { color:#666; }
        .td-score { white-space:nowrap; }
        .td-arrow { color:#1565C0; font-weight:700; font-size:15px; text-align:right; padding-right:18px; }
        .score-num { font-weight:700; font-size:15px; }
        .score-num.pass { color:#2E7D32; }
        .score-num.fail { color:#C62828; }
        .score-of { font-size:11px; color:#aaa; }
        .score-dash { color:#bbb; font-size:14px; }

        /* Badges */
        .badge { display:inline-block; padding:3px 9px; border-radius:12px; font-size:11px; font-weight:600; }
        .badge-pass    { background:#E8F5E9; color:#2E7D32; }
        .badge-fail    { background:#FFEBEE; color:#C62828; }
        .badge-unscored { background:#FFF3E0; color:#E65100; }
        .lev-badge { font-size:12px; font-weight:600; }

        /* Empty */
        .sd-empty { background:#fff; border:1px solid #e0e0e0; border-radius:10px; padding:60px 20px; text-align:center; color:#555; font-size:15px; }
        .sd-empty p { color:#888; margin-top:8px; }

        /* Footer */
        .sd-footer { text-align:center; color:#bbb; font-size:11px; margin-top:30px; }
        </style>`;
    }
}
