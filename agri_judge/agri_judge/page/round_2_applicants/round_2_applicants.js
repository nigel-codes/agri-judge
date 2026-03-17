/**
 * Round 2 Applicants v1
 * Coordinator-only. Manage the shortlist of applications selected for Round 2.
 * - Shows all selected applicants grouped by county
 * - Remove individual applicants
 * - Add applicants from all scored apps not yet in the list
 * - Status tags (Shortlisted / Borderline / Below Threshold) always visible
 * - Export CSV
 */

frappe.pages['round-2-applicants'].on_page_load = function(wrapper) {
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: 'Round 2 Applicants',
        single_column: true
    });
    page.add_button('Home', () => frappe.set_route('/app'), 'octicon octicon-home');
    page.add_button('Advanced Metrics', () => frappe.set_route('judging-advanced-metrics'), 'octicon octicon-graph');
    page.add_button('Leaderboard', () => frappe.set_route('judging-leaderboard'), 'octicon octicon-list-ordered');
    page.set_primary_action('Refresh', () => wrapper._r2 && wrapper._r2.load(), 'octicon octicon-sync');
    wrapper._r2 = new Round2Page(page, wrapper);
};

frappe.pages['round-2-applicants'].on_page_show = function(wrapper) {
    if (wrapper._r2) wrapper._r2.load();
};

class Round2Page {
    constructor(page, wrapper) {
        this.page    = page;
        this.wrapper = $(wrapper).find('.page-content');
        this.data    = [];
    }

    load() {
        this.wrapper.html(this.loadingHtml());
        frappe.call({
            method: 'agri_judge.agri_judge.api.judging.get_round2_list',
            callback: (r) => {
                if (r.message && r.message.success) {
                    this.data = r.message.applicants || [];
                    this.render();
                } else {
                    this.renderError(r.message?.error || 'Failed to load Round 2 list.');
                }
            }
        });
    }

    render() {
        const total = this.data.length;
        const byCounty = {};
        this.data.forEach(a => {
            const c = a.county || 'Unknown';
            if (!byCounty[c]) byCounty[c] = [];
            byCounty[c].push(a);
        });

        const shortlisted = this.data.filter(a => a.score_status === 'Shortlisted').length;
        const borderline  = this.data.filter(a => a.score_status === 'Borderline').length;
        const below       = this.data.filter(a => a.score_status === 'Below Threshold').length;

        const countyColors = {
            'Kakamega': '#1565C0', 'Homabay': '#2E7D32',
            'Kericho':  '#E65100', 'Meru':    '#6A1B9A', 'Other': '#37474F',
        };

        const countySections = Object.keys(byCounty).sort().map(county => {
            const apps  = byCounty[county];
            const color = countyColors[county] || '#37474F';
            return `
            <div class="r2-county-card">
                <div class="r2-county-header" style="border-left-color:${color};">
                    <div class="r2-county-title" style="color:${color};">
                        <span class="county-dot" style="background:${color};"></span>
                        ${frappe.utils.escape_html(county)}
                    </div>
                    <div class="r2-county-count">${apps.length} applicant${apps.length !== 1 ? 's' : ''}</div>
                </div>
                <div class="r2-table">
                    <div class="r2-table-head">
                        <div>Applicant</div>
                        <div>Avg Score</div>
                        <div>Status</div>
                        <div>Added By</div>
                        <div></div>
                    </div>
                    ${apps.map(a => this.renderRow(a)).join('')}
                </div>
            </div>`;
        }).join('');

        this.wrapper.html(`
            ${this.getStyles()}
            <div class="r2-wrap">

                <!-- Header -->
                <div class="r2-header">
                    <div class="r2-header-inner">
                        <div>
                            <h1>📋 Round 2 Applicants</h1>
                            <p class="r2-subtitle">Applications selected for Round 2 — use this list to notify winners</p>
                        </div>
                        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                            <div class="view-badge">🎯 Coordinator</div>
                            <button class="btn-export" onclick="window._r2Export && window._r2Export()">⬇ Export CSV</button>
                        </div>
                    </div>
                </div>

                <!-- Summary stats -->
                <div class="r2-stats">
                    ${this.statCard(total,       'Total Selected',            '#ED1B2E')}
                    ${this.statCard(shortlisted, 'Shortlisted (avg ≥ 7.0)',  '#2E7D32')}
                    ${this.statCard(borderline,  'Borderline (avg 5.0–6.9)', '#FF8F00')}
                    ${this.statCard(below,       'Below Threshold',           '#C62828')}
                    ${this.statCard(Object.keys(byCounty).length, 'Counties Represented', '#1565C0')}
                </div>

                <!-- Add from scored apps button -->
                <div style="margin-bottom:18px;">
                    <button class="btn-add-more" id="btnShowAddPanel">
                        + Add More Applicants
                    </button>
                </div>

                <!-- Add panel (hidden by default) -->
                <div class="add-panel" id="addPanel" style="display:none;">
                    <div class="add-panel-header">
                        <strong>Add Applicants to Round 2</strong>
                        <button class="add-panel-close" id="btnCloseAddPanel">✕</button>
                    </div>
                    <div id="addPanelContent">
                        <div style="padding:20px;text-align:center;color:#888;">Loading scored applications…</div>
                    </div>
                </div>

                <!-- County sections -->
                ${total === 0
                    ? `<div class="r2-empty">
                           <div style="font-size:52px;margin-bottom:16px;">📭</div>
                           <strong>No applicants selected yet.</strong>
                           <p>Go to Advanced Metrics and click "Select Winner" on any scored application.</p>
                           <button class="btn btn-primary" style="margin-top:18px;"
                               onclick="frappe.set_route('judging-advanced-metrics')">
                               Go to Advanced Metrics →
                           </button>
                       </div>`
                    : countySections}

                ${this.getFooter()}
            </div>
        `);

        // Wire remove buttons
        this.wrapper.on('click', '.btn-remove', (e) => {
            const btn  = $(e.currentTarget);
            const name = btn.data('app');
            const row  = btn.closest('.r2-table-row');
            frappe.confirm(
                `Remove <strong>${frappe.utils.escape_html(btn.data('label'))}</strong> from Round 2?`,
                () => this.removeApp(name, row)
            );
        });

        // Add more panel
        this.wrapper.find('#btnShowAddPanel').on('click', () => this.openAddPanel());
        this.wrapper.find('#btnCloseAddPanel').on('click', () => {
            this.wrapper.find('#addPanel').slideUp(200);
        });

        // CSV export
        window._r2Export = () => this.exportCSV();
    }

    renderRow(a) {
        const badge = a.score_status === 'Shortlisted'
            ? '<span class="badge badge-short">✓ Shortlisted</span>'
            : a.score_status === 'Borderline'
                ? '<span class="badge badge-border">Borderline</span>'
                : a.score_status === 'Below Threshold'
                    ? '<span class="badge badge-below">Below Threshold</span>'
                    : '<span class="badge badge-neutral">—</span>';

        return `
        <div class="r2-table-row">
            <div class="app-name-cell">
                <div class="app-name">${frappe.utils.escape_html(a.applicant_name)}</div>
                <div class="app-sub">${frappe.utils.escape_html(a.gender || '')}${a.category ? ' · ' + frappe.utils.escape_html(a.category) : ''}</div>
            </div>
            <div class="score-cell ${a.avg_score >= 7 ? 'score-green' : a.avg_score >= 5 ? 'score-orange' : 'score-red'}">
                ${a.avg_score.toFixed(2)}
            </div>
            <div>${badge}</div>
            <div class="cell-muted" style="font-size:12px;">${frappe.utils.escape_html(a.added_by_name || '')}</div>
            <div>
                <button class="btn-remove"
                        data-app="${frappe.utils.escape_html(a.application)}"
                        data-label="${frappe.utils.escape_html(a.applicant_name)}">
                    Remove
                </button>
            </div>
        </div>`;
    }

    removeApp(applicationName, rowEl) {
        frappe.call({
            method: 'agri_judge.agri_judge.api.judging.remove_from_round2',
            args: { application_name: applicationName },
            callback: (r) => {
                if (r.message && r.message.success) {
                    rowEl.fadeOut(250, () => { rowEl.remove(); });
                    this.data = this.data.filter(a => a.application !== applicationName);
                    frappe.show_alert({ message: 'Removed from Round 2 list', indicator: 'orange' });
                } else {
                    frappe.show_alert({ message: r.message?.error || 'Failed to remove', indicator: 'red' });
                }
            }
        });
    }

    openAddPanel() {
        const panel = this.wrapper.find('#addPanel');
        panel.slideDown(200);
        this.wrapper.find('#addPanelContent').html(
            '<div style="padding:20px;text-align:center;color:#888;">Loading scored applications…</div>'
        );

        // Load all scored apps not yet in round 2
        const currentNames = new Set(this.data.map(a => a.application));
        frappe.call({
            method: 'agri_judge.agri_judge.api.judging.get_advanced_metrics',
            callback: (r) => {
                if (!r.message || !r.message.success) {
                    this.wrapper.find('#addPanelContent').html('<div style="padding:20px;color:#C62828;">Failed to load applications.</div>');
                    return;
                }
                const round2Set = new Set(r.message.round2_apps || []);
                const allScored = [];
                (r.message.counties || []).forEach(c => {
                    [...c.complete_apps, ...c.incomplete_apps].forEach(a => {
                        if (!round2Set.has(a.name)) allScored.push({ ...a, county: c.county });
                    });
                });

                if (!allScored.length) {
                    this.wrapper.find('#addPanelContent').html(
                        '<div style="padding:20px;text-align:center;color:#888;">All scored applications are already in Round 2.</div>'
                    );
                    return;
                }

                const rows = allScored.map(a => {
                    const scoreStatus = a.avg_score >= 7 ? 'Shortlisted' : a.avg_score >= 5 ? 'Borderline' : 'Below Threshold';
                    const badge = a.avg_score >= 7
                        ? '<span class="badge badge-short">✓ Shortlisted</span>'
                        : a.avg_score >= 5
                            ? '<span class="badge badge-border">Borderline</span>'
                            : '<span class="badge badge-below">Below Threshold</span>';
                    return `
                    <div class="add-row">
                        <div class="app-name-cell">
                            <div class="app-name">${frappe.utils.escape_html(a.applicant_name)}</div>
                            <div class="app-sub">${frappe.utils.escape_html(a.county || '')} · ${frappe.utils.escape_html(a.gender || '')}${a.category ? ' · ' + frappe.utils.escape_html(a.category) : ''}</div>
                        </div>
                        <div class="score-cell ${a.avg_score >= 7 ? 'score-green' : a.avg_score >= 5 ? 'score-orange' : 'score-red'}">${a.avg_score !== null ? a.avg_score.toFixed(2) : '—'}</div>
                        <div>${badge}</div>
                        <div>
                            <button class="btn-add-to-r2 btn-select"
                                    data-app="${frappe.utils.escape_html(a.name)}"
                                    data-avg="${a.avg_score !== null ? a.avg_score : 0}"
                                    data-status="${frappe.utils.escape_html(scoreStatus)}">
                                + Add to Round 2
                            </button>
                        </div>
                    </div>`;
                }).join('');

                this.wrapper.find('#addPanelContent').html(`
                    <div class="add-table-head">
                        <div>Applicant</div><div>Avg Score</div><div>Status</div><div>Action</div>
                    </div>
                    ${rows}
                `);

                // Wire add buttons in panel
                this.wrapper.find('.btn-add-to-r2').on('click', (e) => {
                    const btn    = $(e.currentTarget);
                    const name   = btn.data('app');
                    const avg    = parseFloat(btn.data('avg') || 0);
                    const status = btn.data('status') || '';
                    btn.prop('disabled', true).text('Adding…');
                    frappe.call({
                        method: 'agri_judge.agri_judge.api.judging.add_to_round2',
                        args: { application_name: name, avg_score: avg, score_status: status },
                        callback: (r) => {
                            if (r.message && r.message.success) {
                                btn.closest('.add-row').fadeOut(200, function() { $(this).remove(); });
                                frappe.show_alert({ message: 'Added to Round 2', indicator: 'green' });
                                // Reload the main list after a short delay
                                setTimeout(() => this.load(), 400);
                            } else {
                                btn.prop('disabled', false).text('+ Add to Round 2');
                                frappe.show_alert({ message: r.message?.error || 'Failed', indicator: 'red' });
                            }
                        }
                    });
                });
            }
        });
    }

    exportCSV() {
        const lines = [['Applicant', 'County', 'Avg Score', 'Status', 'Gender', 'Category', 'Added By'].join(',')];
        this.data.forEach(a => {
            lines.push([
                `"${(a.applicant_name || '').replace(/"/g, '""')}"`,
                `"${(a.county || '').replace(/"/g, '""')}"`,
                a.avg_score.toFixed(2),
                `"${(a.score_status || '').replace(/"/g, '""')}"`,
                `"${(a.gender || '').replace(/"/g, '""')}"`,
                `"${(a.category || '').replace(/"/g, '""')}"`,
                `"${(a.added_by_name || '').replace(/"/g, '""')}"`,
            ].join(','));
        });
        const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
        const a    = document.createElement('a');
        a.href     = URL.createObjectURL(blob);
        a.download = `round2_applicants_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
    }

    statCard(val, label, color) {
        return `
        <div class="stat-card" style="border-top-color:${color};">
            <div class="stat-num" style="color:${color};">${val}</div>
            <div class="stat-lbl">${label}</div>
        </div>`;
    }

    loadingHtml() {
        return `<div style="text-align:center;padding:100px 20px;color:#888;">
            <div style="font-size:40px;margin-bottom:16px;">⏳</div>
            <p>Loading Round 2 list…</p>
        </div>`;
    }

    renderError(msg) {
        this.wrapper.html(`
            ${this.getStyles()}
            <div class="r2-wrap">
                <div style="text-align:center;padding:80px 20px;">
                    <div style="font-size:48px;margin-bottom:16px;">⚠️</div>
                    <h3 style="color:#ED1B2E;">${frappe.utils.escape_html(msg)}</h3>
                    <button class="btn btn-primary" onclick="location.reload()">Retry</button>
                </div>
            </div>
        `);
    }

    getFooter() {
        return `
        <footer class="krc-footer">
            <div class="krc-footer-inner">
                <div class="krc-footer-brand">
                    <span class="krc-footer-cross">✚</span>
                    <span class="krc-footer-text">Built by <strong>Kenya Red Cross — Digital Transformation Unit</strong></span>
                </div>
                <div class="krc-footer-partners">
                    In partnership with <strong>IOMe</strong> &amp; <strong>Airbus</strong>
                    &nbsp;·&nbsp; AgriWaste Innovation Challenge ${new Date().getFullYear()}
                </div>
            </div>
        </footer>`;
    }

    getStyles() {
        return `<style>
            .r2-wrap { max-width:1100px; margin:0 auto; padding-bottom:0; min-height:calc(100vh - 60px); display:flex; flex-direction:column; font-family:Arial,sans-serif; }

            .r2-header { background:linear-gradient(135deg,#ED1B2E 0%,#8B0000 100%); padding:24px 28px; border-radius:10px; margin-bottom:20px; color:white; }
            .r2-header-inner { display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:12px; }
            .r2-header h1 { margin:0 0 6px; font-size:24px; font-weight:700; }
            .r2-subtitle { margin:0; font-size:13px; opacity:.8; }
            .view-badge { padding:5px 14px; border-radius:20px; font-size:12px; font-weight:700; background:rgba(255,255,255,.2); color:white; }
            .btn-export { background:white; color:#ED1B2E; border:none; padding:7px 16px; border-radius:7px; font-size:13px; font-weight:700; cursor:pointer; transition:all .15s; }
            .btn-export:hover { background:#f8f8f8; transform:scale(1.04); }

            .r2-stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:14px; margin-bottom:20px; }
            .stat-card { background:white; border-radius:10px; padding:18px 20px; box-shadow:0 2px 8px rgba(0,0,0,.06); border-top:4px solid #ED1B2E; }
            .stat-num { font-size:30px; font-weight:800; line-height:1; margin-bottom:4px; }
            .stat-lbl { font-size:11px; color:#999; text-transform:uppercase; letter-spacing:.5px; font-weight:600; }

            /* Add More button */
            .btn-add-more { background:#E3F2FD; color:#1565C0; border:1px solid #BBDEFB; padding:8px 18px; border-radius:7px; font-size:13px; font-weight:700; cursor:pointer; transition:all .15s; font-family:inherit; }
            .btn-add-more:hover { background:#BBDEFB; }

            /* Add panel */
            .add-panel { background:white; border:1px solid #e0e0e0; border-radius:10px; margin-bottom:20px; box-shadow:0 2px 8px rgba(0,0,0,.06); overflow:hidden; }
            .add-panel-header { display:flex; justify-content:space-between; align-items:center; padding:12px 18px; background:#f5f5f5; border-bottom:1px solid #e0e0e0; font-size:14px; }
            .add-panel-close { background:none; border:none; font-size:16px; cursor:pointer; color:#888; line-height:1; padding:2px 6px; border-radius:4px; }
            .add-panel-close:hover { background:#e0e0e0; }
            .add-table-head { display:grid; grid-template-columns:1fr 90px 130px 140px; padding:9px 16px; background:#1a1a1a; color:white; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.5px; gap:8px; }
            .add-row { display:grid; grid-template-columns:1fr 90px 130px 140px; padding:11px 16px; border-bottom:1px solid #f5f5f5; align-items:center; gap:8px; }
            .add-row:last-child { border-bottom:none; }
            .add-row:hover { background:#fafafa; }

            /* County card */
            .r2-county-card { background:white; border-radius:10px; box-shadow:0 2px 8px rgba(0,0,0,.06); margin-bottom:18px; overflow:hidden; }
            .r2-county-header { padding:14px 20px 12px; border-left:5px solid #ED1B2E; display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
            .r2-county-title { font-size:17px; font-weight:800; display:flex; align-items:center; gap:8px; }
            .county-dot { width:12px; height:12px; border-radius:50%; flex-shrink:0; }
            .r2-county-count { font-size:12px; color:#999; }

            /* Table */
            .r2-table { }
            .r2-table-head { display:grid; grid-template-columns:1fr 90px 130px 1fr 90px; padding:9px 18px; background:#1a1a1a; color:white; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.5px; gap:8px; }
            .r2-table-row { display:grid; grid-template-columns:1fr 90px 130px 1fr 90px; padding:12px 18px; border-bottom:1px solid #f5f5f5; align-items:center; gap:8px; }
            .r2-table-row:last-child { border-bottom:none; }
            .r2-table-row:hover { background:#fafafa; }
            .app-name-cell { display:flex; flex-direction:column; }
            .app-name { font-size:14px; font-weight:700; color:#1a1a1a; }
            .app-sub  { font-size:11px; color:#aaa; margin-top:1px; }
            .score-cell { font-size:15px; font-weight:800; }
            .score-green  { color:#2E7D32; }
            .score-orange { color:#E65100; }
            .score-red    { color:#C62828; }
            .cell-muted { color:#888; }

            /* Status badges */
            .badge { padding:3px 9px; border-radius:12px; font-size:11px; font-weight:700; white-space:nowrap; }
            .badge-short   { background:#E8F5E9; color:#2E7D32; }
            .badge-border  { background:#FFF3E0; color:#E65100; }
            .badge-below   { background:#FFEBEE; color:#C62828; }
            .badge-neutral { background:#F5F5F5; color:#888; }

            /* Buttons */
            .btn-remove { background:#FFEBEE; color:#C62828; border:1px solid #FFCDD2; padding:4px 12px; border-radius:7px; font-size:12px; font-weight:700; cursor:pointer; transition:all .15s; font-family:inherit; }
            .btn-remove:hover { background:#FFCDD2; }
            .btn-select { background:#E3F2FD; color:#1565C0; border:1px solid #BBDEFB; padding:5px 12px; border-radius:7px; font-size:12px; font-weight:700; cursor:pointer; transition:all .15s; font-family:inherit; }
            .btn-select:hover { background:#BBDEFB; }
            .btn-select:disabled { opacity:.5; cursor:not-allowed; }

            .r2-empty { padding:70px 30px; text-align:center; color:#aaa; font-size:15px; }
            .r2-empty p { font-size:13px; margin-top:8px; }

            .krc-footer { margin-top:32px; border-top:2px solid #f0f0f0; padding:16px 0 22px; }
            .krc-footer-inner { display:flex; flex-direction:column; align-items:center; gap:5px; text-align:center; }
            .krc-footer-brand { display:flex; align-items:center; gap:10px; font-size:13px; color:#555; }
            .krc-footer-cross { font-size:20px; color:#ED1B2E; font-weight:900; line-height:1; }
            .krc-footer-text strong { color:#ED1B2E; }
            .krc-footer-partners { font-size:12px; color:#aaa; }
            .krc-footer-partners strong { color:#777; }
        </style>`;
    }
}
