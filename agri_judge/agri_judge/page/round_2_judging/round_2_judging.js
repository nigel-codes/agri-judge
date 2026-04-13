/**
 * Round 2 Judging v1
 * Coordinator-only. Score each Round 2 Response out of 10.
 * - Lists all Round 2 Responses grouped by county
 * - Expandable view of innovation_description and resources_needed
 * - Score (0–10) + notes input per applicant, with inline save
 * - Summary stats: total, scored, unscored, average
 */

frappe.pages['round-2-judging'].on_page_load = function(wrapper) {
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: 'Round 2 Judging',
        single_column: true
    });
    page.add_button('Home', () => frappe.set_route('/app'), 'octicon octicon-home');
    page.add_button('R2 Scoring Dashboard', () => frappe.set_route('round-2-scoring-dashboard'), 'octicon octicon-dashboard', 'btn-primary');
    page.set_primary_action('Refresh', () => wrapper._r2j && wrapper._r2j.load(), 'octicon octicon-sync');
    wrapper._r2j = new Round2Judging(page, wrapper);
};

frappe.pages['round-2-judging'].on_page_show = function(wrapper) {
    if (wrapper._r2j) wrapper._r2j.load();
};

class Round2Judging {
    constructor(page, wrapper) {
        this.page    = page;
        this.wrapper = $(wrapper).find('.page-content');
        this.data    = [];
    }

    load() {
        this.wrapper.html(this.loadingHtml());
        frappe.call({
            method: 'agri_judge.agri_judge.api.judging.get_round2_responses_for_judging',
            callback: (r) => {
                if (r.message && r.message.success) {
                    this.data = r.message.responses || [];
                    this.render();
                } else {
                    this.renderError(r.message?.error || 'Failed to load Round 2 responses.');
                }
            }
        });
    }

    render() {
        const total   = this.data.length;
        const scored  = this.data.filter(r => r.score !== null && r.score !== undefined && r.score !== 0).length;
        const unscored = total - scored;
        const scores  = this.data.filter(r => r.score > 0).map(r => r.score);
        const avg     = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length) : 0;

        const byCounty = {};
        this.data.forEach(r => {
            const c = r.county || 'Unknown';
            if (!byCounty[c]) byCounty[c] = [];
            byCounty[c].push(r);
        });

        const countyColors = {
            'Kakamega': '#1565C0', 'Homabay': '#2E7D32',
            'Kericho': '#E65100', 'Meru': '#6A1B9A', 'Other': '#37474F',
        };

        const countySections = Object.keys(byCounty).sort().map(county => {
            const apps  = byCounty[county];
            const color = countyColors[county] || '#37474F';
            const cScored = apps.filter(a => a.score > 0).length;
            return `
            <div class="r2j-county-card">
                <div class="r2j-county-header" style="border-left-color:${color};">
                    <div class="r2j-county-title" style="color:${color};">
                        <span class="r2j-dot" style="background:${color};"></span>
                        ${frappe.utils.escape_html(county)}
                    </div>
                    <div class="r2j-county-meta">
                        ${cScored}/${apps.length} scored
                    </div>
                </div>
                ${apps.map(a => this.renderRow(a)).join('')}
            </div>`;
        }).join('');

        this.wrapper.html(`
            ${this.getStyles()}
            <div class="r2j-wrap">

                <div class="r2j-header">
                    <div class="r2j-header-inner">
                        <div>
                            <h1>⚖️ Round 2 Judging</h1>
                            <p class="r2j-subtitle">Score each Round 2 submission out of 10</p>
                        </div>
                        <div class="view-badge">🎯 Coordinator</div>
                    </div>
                </div>

                <div class="r2j-stats">
                    ${this.statCard(total,   'Total Responses',   '#1565C0')}
                    ${this.statCard(scored,  'Scored',            '#2E7D32')}
                    ${this.statCard(unscored,'Unscored',          '#E65100')}
                    ${this.statCard(avg > 0 ? avg.toFixed(1) : '—', 'Avg Score', '#6A1B9A')}
                </div>

                ${total === 0
                    ? `<div class="r2j-empty">
                           <div style="font-size:52px;margin-bottom:16px;">📭</div>
                           <strong>No Round 2 responses yet.</strong>
                           <p>Responses will appear here once shortlisted applicants have submitted their Round 2 forms.</p>
                       </div>`
                    : countySections}

                <div class="r2j-footer">
                    Round 2 Judging · Agri Judge · ${new Date().getFullYear()}
                </div>
            </div>
        `);

        // Open dedicated review page on row click
        this.wrapper.on('click', '.r2j-row', (e) => {
            const name = $(e.currentTarget).data('name');
            frappe.set_route('round-2-response-review', name);
        });
    }

    renderRow(r) {
        const hasScore    = r.score > 0;
        const scoreDisp   = hasScore ? r.score.toFixed(1) : '—';
        const scoredBadge = hasScore
            ? `<span class="badge badge-scored">✓ ${scoreDisp} / 10</span>`
            : `<span class="badge badge-unscored">Unscored</span>`;

        const devLevel = frappe.utils.escape_html(r.developmental_level || '');
        const gender   = frappe.utils.escape_html(r.gender || '');
        const isTech   = r.is_tech_enabled ? '<span class="badge badge-tech">Tech-enabled</span>' : '';
        const scoredBy = r.scored_by
            ? `<span class="row-meta">Scored by ${frappe.utils.escape_html(r.scored_by_name || r.scored_by)}</span>`
            : '';

        return `
        <div class="r2j-row" data-name="${frappe.utils.escape_html(r.name)}">
            <div class="r2j-row-left">
                <div class="app-name">${frappe.utils.escape_html(r.applicant_name)}</div>
                <div class="app-sub">${gender}${devLevel ? ' · ' + devLevel : ''} ${isTech} ${scoredBy}</div>
            </div>
            <div class="r2j-row-right">
                ${scoredBadge}
                <span class="r2j-open-icon">→</span>
            </div>
        </div>`;
    }

    statCard(value, label, color) {
        return `
        <div class="r2j-stat-card" style="border-top-color:${color};">
            <div class="r2j-stat-value" style="color:${color};">${value}</div>
            <div class="r2j-stat-label">${label}</div>
        </div>`;
    }

    loadingHtml() {
        return `
        <div style="padding:60px;text-align:center;color:#888;">
            <div style="font-size:40px;margin-bottom:12px;">⏳</div>
            <p>Loading Round 2 responses…</p>
        </div>`;
    }

    renderError(msg) {
        this.wrapper.html(`
        <div style="padding:60px;text-align:center;color:#C62828;">
            <div style="font-size:40px;margin-bottom:12px;">⚠️</div>
            <p>${frappe.utils.escape_html(msg)}</p>
        </div>`);
    }

    getStyles() {
        return `
        <style>
        .r2j-wrap { max-width:960px; margin:0 auto; padding:20px 16px 60px; font-family:var(--font-stack); }

        /* Header */
        .r2j-header { background:#fff; border:1px solid #e0e0e0; border-radius:10px; padding:20px 24px; margin-bottom:20px; }
        .r2j-header-inner { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; }
        .r2j-header h1 { margin:0 0 4px; font-size:22px; font-weight:700; }
        .r2j-subtitle { margin:0; color:#666; font-size:13px; }
        .view-badge { background:#1565C0; color:#fff; padding:4px 12px; border-radius:20px; font-size:12px; font-weight:600; }

        /* Stats */
        .r2j-stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:12px; margin-bottom:20px; }
        .r2j-stat-card { background:#fff; border:1px solid #e0e0e0; border-top:3px solid #ccc; border-radius:8px; padding:14px 16px; text-align:center; }
        .r2j-stat-value { font-size:26px; font-weight:700; line-height:1.2; }
        .r2j-stat-label { font-size:11px; color:#666; margin-top:4px; text-transform:uppercase; letter-spacing:.5px; }

        /* County card */
        .r2j-county-card { background:#fff; border:1px solid #e0e0e0; border-radius:10px; margin-bottom:18px; overflow:hidden; }
        .r2j-county-header { display:flex; justify-content:space-between; align-items:center; padding:12px 18px; border-left:4px solid #ccc; background:#fafafa; }
        .r2j-county-title { display:flex; align-items:center; gap:8px; font-weight:700; font-size:15px; }
        .r2j-dot { width:10px; height:10px; border-radius:50%; display:inline-block; }
        .r2j-county-meta { font-size:12px; color:#666; }

        /* Row */
        .r2j-row { display:flex; justify-content:space-between; align-items:center; padding:12px 18px; border-top:1px solid #eee; cursor:pointer; transition:background .15s; }
        .r2j-row:hover { background:#f0f4ff; }
        .r2j-row-left .app-name { font-weight:600; font-size:14px; }
        .r2j-row-left .app-sub { font-size:12px; color:#888; margin-top:2px; display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
        .row-meta { color:#aaa; font-style:italic; }
        .r2j-row-right { display:flex; align-items:center; gap:10px; flex-shrink:0; }
        .r2j-open-icon { font-size:16px; color:#1565C0; font-weight:700; }

        /* Badges */
        .badge { display:inline-block; padding:3px 9px; border-radius:12px; font-size:11px; font-weight:600; }
        .badge-scored  { background:#E8F5E9; color:#2E7D32; }
        .badge-unscored { background:#FFF3E0; color:#E65100; }
        .badge-tech    { background:#E3F2FD; color:#1565C0; }

        /* Empty state */
        .r2j-empty { background:#fff; border:1px solid #e0e0e0; border-radius:10px; padding:60px 20px; text-align:center; color:#555; }
        .r2j-empty p { color:#888; margin-top:8px; }

        /* Footer */
        .r2j-footer { text-align:center; color:#bbb; font-size:11px; margin-top:30px; }
        </style>`;
    }
}
