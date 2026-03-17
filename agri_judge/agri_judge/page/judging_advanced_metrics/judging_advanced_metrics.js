/**
 * Advanced Metrics v2
 * Coordinator-only. Shows per-county application completion status,
 * pending judge breakdown, shortlisted/borderline/below counts,
 * and Select Winner buttons that add to the Round 2 shortlist.
 */

frappe.pages['judging-advanced-metrics'].on_page_load = function(wrapper) {
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: 'Advanced Metrics',
        single_column: true
    });
    page.add_button('Home', () => frappe.set_route('/app'), 'octicon octicon-home');
    page.add_button('Leaderboard', () => frappe.set_route('judging-leaderboard'), 'octicon octicon-graph');
    page.add_button('Round 2 List', () => frappe.set_route('round-2-applicants'), 'octicon octicon-checklist');
    page.add_button('Back to Dashboard', () => frappe.set_route('judge-dashboard'), 'octicon octicon-arrow-left');
    page.set_primary_action('Refresh', () => wrapper._am && wrapper._am.load(), 'octicon octicon-sync');
    wrapper._am = new AdvancedMetrics(page, wrapper);
};

frappe.pages['judging-advanced-metrics'].on_page_show = function(wrapper) {
    if (wrapper._am) wrapper._am.load();
};

class AdvancedMetrics {
    constructor(page, wrapper) {
        this.page      = page;
        this.wrapper   = $(wrapper).find('.page-content');
        this.round2    = new Set(); // application names already in round 2
    }

    load() {
        this.wrapper.html(this.loadingHtml());
        frappe.call({
            method: 'agri_judge.agri_judge.api.judging.get_advanced_metrics',
            callback: (r) => {
                if (r.message && r.message.success) {
                    this.round2 = new Set(r.message.round2_apps || []);
                    this.render(r.message);
                } else {
                    this.renderError(r.message?.error || 'Failed to load metrics.');
                }
            }
        });
    }

    render(data) {
        const t = data.totals;
        const counties = data.counties || [];

        const countyColors = {
            'Kakamega': '#1565C0',
            'Homabay':  '#2E7D32',
            'Kericho':  '#E65100',
            'Meru':     '#6A1B9A',
            'Other':    '#37474F',
        };

        const countySections = counties.map(c => this.renderCounty(c, countyColors[c.county] || '#37474F')).join('');

        this.wrapper.html(`
            ${this.getStyles()}
            <div class="am-wrap">

                <!-- Header -->
                <div class="am-header">
                    <div class="am-header-inner">
                        <div>
                            <h1>📊 Advanced Metrics</h1>
                            <p class="am-subtitle">Coordinator view — application completion status, pending judges, per-county breakdown</p>
                        </div>
                        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                            <div class="view-badge">🎯 Coordinator</div>
                            <button class="btn-round2-nav" onclick="frappe.set_route('round-2-applicants')">
                                📋 View Round 2 List
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Overall summary stats -->
                <div class="am-stats">
                    ${this.statCard(t.total_apps,   'Total Applications',         '#ED1B2E')}
                    ${this.statCard(t.complete,      'Fully Judged',               '#2E7D32')}
                    ${this.statCard(t.incomplete,    'Judging In Progress',        '#E65100')}
                    ${this.statCard(t.unevaluated,   'Not Yet Started',            '#9E9E9E')}
                    ${this.statCard(t.shortlisted,   'Shortlisted (avg ≥ 7.0)',    '#1565C0')}
                    ${this.statCard(t.borderline,    'Borderline (avg 5.0–6.9)',   '#FF8F00')}
                    ${this.statCard(t.below,         'Below Threshold (avg < 5.0)','#C62828')}
                </div>

                <!-- Per-county sections -->
                ${countySections.length ? countySections : `
                    <div class="am-empty">
                        <div style="font-size:48px;margin-bottom:14px;">📭</div>
                        <strong>No county data available.</strong>
                        <p>Make sure applications have been submitted and judges are assigned to counties.</p>
                    </div>`}

                ${this.getFooter()}
            </div>
        `);

        // Accordion toggles
        this.wrapper.find('.am-section-toggle').on('click', function() {
            const target = $($(this).data('target'));
            target.toggleClass('open');
            $(this).find('.toggle-icon').text(target.hasClass('open') ? '▲' : '▼');
        });

        // Select Winner button clicks (event delegation)
        this.wrapper.on('click', '.btn-select-winner', (e) => {
            const btn  = $(e.currentTarget);
            const name = btn.data('app');
            const avg  = parseFloat(btn.data('avg') || 0);
            const status = btn.data('status') || '';
            if (btn.hasClass('in-round2')) {
                this.removeFromRound2(name, btn);
            } else {
                this.addToRound2(name, avg, status, btn);
            }
        });
    }

    addToRound2(appName, avgScore, status, btn) {
        btn.prop('disabled', true).text('Adding…');
        frappe.call({
            method: 'agri_judge.agri_judge.api.judging.add_to_round2',
            args: { application_name: appName, avg_score: avgScore, score_status: status },
            callback: (r) => {
                if (r.message && r.message.success) {
                    this.round2.add(appName);
                    btn.prop('disabled', false)
                       .removeClass('btn-select')
                       .addClass('btn-in-round2 in-round2')
                       .html('✓ In Round 2 &nbsp;<span class="btn-remove-hint">Remove</span>');
                    frappe.show_alert({ message: 'Added to Round 2 list', indicator: 'green' });
                } else {
                    btn.prop('disabled', false).text('Select Winner');
                    frappe.show_alert({ message: r.message?.error || 'Failed to add', indicator: 'red' });
                }
            }
        });
    }

    removeFromRound2(appName, btn) {
        btn.prop('disabled', true).text('Removing…');
        frappe.call({
            method: 'agri_judge.agri_judge.api.judging.remove_from_round2',
            args: { application_name: appName },
            callback: (r) => {
                if (r.message && r.message.success) {
                    this.round2.delete(appName);
                    btn.prop('disabled', false)
                       .removeClass('btn-in-round2 in-round2')
                       .addClass('btn-select')
                       .text('Select Winner');
                    frappe.show_alert({ message: 'Removed from Round 2 list', indicator: 'orange' });
                } else {
                    btn.prop('disabled', false).html('✓ In Round 2 &nbsp;<span class="btn-remove-hint">Remove</span>');
                    frappe.show_alert({ message: r.message?.error || 'Failed to remove', indicator: 'red' });
                }
            }
        });
    }

    renderCounty(c, color) {
        const pct = c.total_apps ? Math.round((c.complete / c.total_apps) * 100) : 0;
        const uid = c.county.replace(/\s+/g, '_').toLowerCase();

        const incompleteTable = c.incomplete_apps.length ? `
            <h4 class="sub-heading">⏳ In Progress — Pending Judge(s)</h4>
            <div class="app-table">
                <div class="app-table-head" style="grid-template-columns:1fr 90px 90px 1fr 120px;">
                    <div>Applicant</div><div>Avg Score</div><div>Judges Done</div><div>Pending Judge(s)</div><div>Round 2</div>
                </div>
                ${c.incomplete_apps.map(a => this.renderScoredRow(a, '1fr 90px 90px 1fr 120px')).join('')}
            </div>` : '';

        const unevalTable = c.unevaluated_apps.length ? `
            <h4 class="sub-heading">🔴 Not Yet Started</h4>
            <div class="app-table">
                <div class="app-table-head" style="grid-template-columns:1fr 1fr;">
                    <div>Applicant</div><div>Assigned Judges (none have started)</div>
                </div>
                ${c.unevaluated_apps.map(a => `
                    <div class="app-table-row" style="grid-template-columns:1fr 1fr;">
                        <div class="app-name-cell">
                            <div class="app-name">${frappe.utils.escape_html(a.applicant_name)}</div>
                            <div class="app-sub">${frappe.utils.escape_html(a.gender || '')}${a.category ? ' · ' + frappe.utils.escape_html(a.category) : ''}</div>
                        </div>
                        <div class="pending-list">
                            ${a.pending_judges.length
                                ? a.pending_judges.map(j => `<span class="judge-chip chip-red">${frappe.utils.escape_html(j.judge_name)}</span>`).join('')
                                : '<span style="color:#aaa;font-size:12px;">No judges assigned</span>'}
                        </div>
                    </div>`).join('')}
            </div>` : '';

        const completeTable = c.complete_apps.length ? `
            <h4 class="sub-heading">✅ Fully Judged</h4>
            <div class="app-table">
                <div class="app-table-head" style="grid-template-columns:1fr 90px 80px 120px 120px;">
                    <div>Applicant</div><div>Avg Score</div><div>Judges</div><div>Status</div><div>Round 2</div>
                </div>
                ${c.complete_apps.map(a => this.renderScoredRow(a, '1fr 90px 80px 120px 120px', true)).join('')}
            </div>` : '';

        const hasDetail = incompleteTable || unevalTable || completeTable;

        return `
        <div class="am-county-card">
            <div class="county-header" style="border-left-color:${color};">
                <div class="county-title" style="color:${color};">
                    <span class="county-dot" style="background:${color};"></span>
                    ${frappe.utils.escape_html(c.county)}
                </div>
                <div class="county-meta">${c.total_apps} application${c.total_apps !== 1 ? 's' : ''} · ${c.judges_count} judge${c.judges_count !== 1 ? 's' : ''} assigned</div>
                <div class="county-progress-wrap">
                    <div class="county-progress-bar">
                        <div class="county-progress-fill" style="width:${pct}%;background:${color};"></div>
                    </div>
                    <span class="county-pct">${pct}% fully judged</span>
                </div>
            </div>

            <div class="county-stats">
                ${this.miniStat(c.complete,    'Fully Judged',     '#2E7D32')}
                ${this.miniStat(c.incomplete,  'In Progress',      '#E65100')}
                ${this.miniStat(c.unevaluated, 'Not Started',      '#9E9E9E')}
                ${this.miniStat(c.shortlisted, 'Shortlisted',      '#1565C0')}
                ${this.miniStat(c.borderline,  'Borderline',       '#FF8F00')}
                ${this.miniStat(c.below,       'Below Threshold',  '#C62828')}
            </div>

            ${hasDetail ? `
            <div class="am-section-toggle" data-target="#detail-${uid}">
                <span>View Application Details</span>
                <span class="toggle-icon">▼</span>
            </div>
            <div class="county-detail" id="detail-${uid}">
                ${incompleteTable}
                ${unevalTable}
                ${completeTable}
            </div>` : ''}
        </div>`;
    }

    renderScoredRow(a, cols, showJudgeCount = false) {
        const statusBadge = a.avg_score === null ? '' :
            a.avg_score >= 7
                ? '<span class="badge badge-short">✓ Shortlisted</span>'
                : a.avg_score >= 5
                    ? '<span class="badge badge-border">Borderline</span>'
                    : '<span class="badge badge-below">Below Threshold</span>';

        const scoreStatus = a.avg_score === null ? '' :
            a.avg_score >= 7 ? 'Shortlisted' : a.avg_score >= 5 ? 'Borderline' : 'Below Threshold';

        const inRound2   = this.round2.has(a.name);
        const btnClass   = inRound2 ? 'btn-select-winner btn-in-round2 in-round2' : 'btn-select-winner btn-select';
        const btnContent = inRound2
            ? '✓ In Round 2 &nbsp;<span class="btn-remove-hint">Remove</span>'
            : 'Select Winner';

        const pendingCol = showJudgeCount
            ? `<div class="cell-center">${a.judges_done}</div>`
            : `<div class="pending-list">${a.pending_judges.map(j => `<span class="judge-chip">${frappe.utils.escape_html(j.judge_name)}</span>`).join('')}</div>`;

        return `
        <div class="app-table-row" style="grid-template-columns:${cols};">
            <div class="app-name-cell">
                <div class="app-name">${frappe.utils.escape_html(a.applicant_name)}</div>
                <div class="app-sub">${frappe.utils.escape_html(a.gender || '')}${a.category ? ' · ' + frappe.utils.escape_html(a.category) : ''}</div>
            </div>
            <div class="score-cell ${a.avg_score >= 7 ? 'score-green' : a.avg_score >= 5 ? 'score-orange' : 'score-red'}">
                ${a.avg_score !== null ? a.avg_score.toFixed(2) : '—'}
            </div>
            ${pendingCol}
            <div>${statusBadge}</div>
            <div>
                <button class="${btnClass}"
                        data-app="${frappe.utils.escape_html(a.name)}"
                        data-avg="${a.avg_score !== null ? a.avg_score : 0}"
                        data-status="${frappe.utils.escape_html(scoreStatus)}">
                    ${btnContent}
                </button>
            </div>
        </div>`;
    }

    statCard(val, label, color) {
        return `
        <div class="stat-card" style="border-top-color:${color};">
            <div class="stat-num" style="color:${color};">${val}</div>
            <div class="stat-lbl">${label}</div>
        </div>`;
    }

    miniStat(val, label, color) {
        return `
        <div class="mini-stat">
            <div class="mini-num" style="color:${color};">${val}</div>
            <div class="mini-lbl">${label}</div>
        </div>`;
    }

    loadingHtml() {
        return `
        <div style="text-align:center;padding:100px 20px;color:#888;">
            <div style="font-size:40px;margin-bottom:16px;">⏳</div>
            <p>Loading metrics…</p>
        </div>`;
    }

    renderError(msg) {
        this.wrapper.html(`
            ${this.getStyles()}
            <div class="am-wrap">
                <div style="text-align:center;padding:80px 20px;">
                    <div style="font-size:48px;margin-bottom:16px;">⚠️</div>
                    <h3 style="color:#ED1B2E;">${frappe.utils.escape_html(msg)}</h3>
                    <button class="btn btn-primary" onclick="location.reload()">Retry</button>
                </div>
                ${this.getFooter()}
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
            .am-wrap { max-width:1260px; margin:0 auto; padding-bottom:0; min-height:calc(100vh - 60px); display:flex; flex-direction:column; font-family:Arial,sans-serif; }

            .am-header { background:linear-gradient(135deg,#ED1B2E 0%,#8B0000 100%); padding:24px 28px; border-radius:10px; margin-bottom:20px; color:white; }
            .am-header-inner { display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:12px; }
            .am-header h1 { margin:0 0 6px; font-size:24px; font-weight:700; }
            .am-subtitle { margin:0; font-size:13px; opacity:.8; }
            .view-badge { padding:5px 14px; border-radius:20px; font-size:12px; font-weight:700; background:rgba(255,255,255,.2); color:white; }
            .btn-round2-nav { background:white; color:#ED1B2E; border:none; padding:7px 16px; border-radius:7px; font-size:13px; font-weight:700; cursor:pointer; transition:all .15s; }
            .btn-round2-nav:hover { background:#f8f8f8; transform:scale(1.04); }

            .am-stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:14px; margin-bottom:24px; }
            .stat-card { background:white; border-radius:10px; padding:18px 20px; box-shadow:0 2px 8px rgba(0,0,0,.06); border-top:4px solid #ED1B2E; }
            .stat-num { font-size:30px; font-weight:800; line-height:1; margin-bottom:4px; }
            .stat-lbl { font-size:11px; color:#999; text-transform:uppercase; letter-spacing:.5px; font-weight:600; }

            .am-county-card { background:white; border-radius:10px; box-shadow:0 2px 8px rgba(0,0,0,.06); margin-bottom:18px; overflow:hidden; }
            .county-header { padding:18px 22px 14px; border-left:5px solid #ED1B2E; }
            .county-title { font-size:18px; font-weight:800; display:flex; align-items:center; gap:8px; margin-bottom:4px; }
            .county-dot { width:12px; height:12px; border-radius:50%; display:inline-block; flex-shrink:0; }
            .county-meta { font-size:12px; color:#888; margin-bottom:10px; }
            .county-progress-wrap { display:flex; align-items:center; gap:10px; }
            .county-progress-bar { flex:1; height:8px; background:#f0f0f0; border-radius:4px; overflow:hidden; max-width:300px; }
            .county-progress-fill { height:100%; border-radius:4px; transition:width .4s; }
            .county-pct { font-size:12px; color:#666; font-weight:700; white-space:nowrap; }

            .county-stats { display:flex; flex-wrap:wrap; gap:0; border-top:1px solid #f0f0f0; border-bottom:1px solid #f0f0f0; }
            .mini-stat { flex:1; min-width:90px; padding:12px 16px; text-align:center; border-right:1px solid #f5f5f5; }
            .mini-stat:last-child { border-right:none; }
            .mini-num { font-size:22px; font-weight:800; line-height:1; margin-bottom:2px; }
            .mini-lbl { font-size:10px; color:#aaa; text-transform:uppercase; letter-spacing:.4px; font-weight:600; }

            .am-section-toggle { display:flex; justify-content:space-between; align-items:center; padding:11px 22px; background:#fafafa; cursor:pointer; font-size:13px; font-weight:600; color:#555; user-select:none; border-top:1px solid #f0f0f0; transition:background .15s; }
            .am-section-toggle:hover { background:#f4f4f4; }
            .toggle-icon { font-size:11px; color:#bbb; }

            .county-detail { display:none; padding:18px 22px 20px; }
            .county-detail.open { display:block; }
            .sub-heading { font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:.5px; color:#888; margin:14px 0 8px; }
            .sub-heading:first-child { margin-top:0; }

            .app-table { border:1px solid #f0f0f0; border-radius:8px; overflow:hidden; margin-bottom:18px; }
            .app-table-head { display:grid; padding:9px 14px; background:#1a1a1a; color:white; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.5px; gap:8px; }
            .app-table-row { display:grid; padding:11px 14px; border-bottom:1px solid #f5f5f5; align-items:center; gap:8px; }
            .app-table-row:last-child { border-bottom:none; }
            .app-table-row:hover { background:#fafafa; }
            .app-name-cell { display:flex; flex-direction:column; }
            .app-name { font-size:14px; font-weight:700; color:#1a1a1a; }
            .app-sub  { font-size:11px; color:#aaa; margin-top:1px; }
            .score-cell { font-size:15px; font-weight:800; }
            .score-green  { color:#2E7D32; }
            .score-orange { color:#E65100; }
            .score-red    { color:#C62828; }
            .cell-center { font-size:13px; color:#555; text-align:center; }

            .pending-list { display:flex; flex-wrap:wrap; gap:5px; }
            .judge-chip { background:#FFF3E0; color:#E65100; border:1px solid #FFCC80; padding:3px 9px; border-radius:12px; font-size:11px; font-weight:700; }
            .chip-red { background:#FFEBEE; color:#C62828; border-color:#FFCDD2; }

            /* Status badges */
            .badge { padding:3px 9px; border-radius:12px; font-size:11px; font-weight:700; white-space:nowrap; }
            .badge-short  { background:#E8F5E9; color:#2E7D32; }
            .badge-border { background:#FFF3E0; color:#E65100; }
            .badge-below  { background:#FFEBEE; color:#C62828; }

            /* Select Winner / Round 2 buttons */
            .btn-select-winner { border:none; border-radius:7px; padding:5px 12px; font-size:12px; font-weight:700; cursor:pointer; transition:all .15s; font-family:inherit; white-space:nowrap; }
            .btn-select { background:#E3F2FD; color:#1565C0; border:1px solid #BBDEFB; }
            .btn-select:hover { background:#BBDEFB; }
            .btn-in-round2 { background:#E8F5E9; color:#2E7D32; border:1px solid #A5D6A7; }
            .btn-in-round2:hover { background:#FFEBEE; color:#C62828; border-color:#FFCDD2; }
            .btn-remove-hint { font-size:10px; font-weight:600; opacity:.7; }
            .btn-select-winner:disabled { opacity:.5; cursor:not-allowed; }

            .am-empty { padding:70px 30px; text-align:center; color:#aaa; font-size:15px; }
            .am-empty p { font-size:13px; margin-top:8px; }

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
